import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AudioAsset, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../shared/prisma/prisma.service";
import type { Env } from "../../shared/config/env.schema";
import type { AudioProvider } from "./audio-provider.interface";
import type { AudioStorageProvider } from "./audio-storage.interface";
import { AUDIO_PROVIDER, AUDIO_STORAGE } from "./tts.tokens";
import { VoiceIdMap } from "./voice-id.types";
import { SequenceIndexOutOfRangeError } from "./tts.errors";

const ARGUMENT_WITH_AGENT_INCLUDE = { agent: true } satisfies Prisma.ArgumentInclude;
type ArgumentWithAgent = Prisma.ArgumentGetPayload<{ include: typeof ARGUMENT_WITH_AGENT_INCLUDE }>;

// mimeType -> extensión de archivo, para nombrar storageKey. "bin" de
// fallback: no debería pegarle nunca ningún AudioProvider real (todos los
// mimeType conocidos están mapeados), pero es preferible a un storageKey
// sin extensión si algún proveedor futuro devuelve algo inesperado.
const MIME_EXTENSIONS: Record<string, string> = {
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
};

// architecture.md §7 (Feature 6) — "segmento" = un Argument OFFICIAL (1:1
// vía Argument.audioAssetId @unique, sin concepto de segmentación nuevo).
// synthesizeSegment()/getOrderedOfficialArguments() cubren el camino crítico
// Local end-to-end (etapa 2). regenerateSegmentByIndex()/getSignedAudioUrl()
// (etapa 3, AC 6.2/6.1) reusan ambos sin duplicar la resolución de voiceId.
@Injectable()
export class TtsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    @Inject(AUDIO_PROVIDER) private readonly provider: AudioProvider,
    @Inject(AUDIO_STORAGE) private readonly storage: AudioStorageProvider
  ) {}

  // Mismo shape/orden que buildDebateContext (episode-orchestrator.service.ts)
  // — createdAt asc sobre officialArguments de la Debate del episodio. Este
  // orden ES el sequenceIndex de AC 6.2 (posición 1-based, derivado, sin
  // columna nueva — decision-log.md 2026-09-09, #20 punto 3).
  async getOrderedOfficialArguments(episodeId: string): Promise<ArgumentWithAgent[]> {
    const episode = await this.prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { debateId: true },
    });
    return this.prisma.argument.findMany({
      where: { debateRound: { debateId: episode.debateId }, status: "OFFICIAL" },
      include: ARGUMENT_WITH_AGENT_INCLUDE,
      orderBy: { createdAt: "asc" },
    });
  }

  // Genera el audio de UN segmento, lo persiste en storage + AudioAsset, y
  // enlaza Argument.audioAssetId. El motor activo (AUDIO_PROVIDER) y qué
  // entrada de Agent.voiceId usar (VoiceIdMap por proveedor, no un string
  // único — decision-log.md #20 punto 1) se resuelven acá, no en el caller.
  async synthesizeSegment(episodeId: string, argument: ArgumentWithAgent): Promise<AudioAsset> {
    const created = await this.synthesizeAndSave(episodeId, argument);
    await this.prisma.argument.update({ where: { id: argument.id }, data: { audioAssetId: created.id } });
    return created;
  }

  // AC 6.2 (features.md Feature 6): regenera el audio de un único
  // sequenceIndex sin alterar el resto del episodio. sequenceIndex es
  // 1-based sobre el mismo orden que getOrderedOfficialArguments (createdAt
  // asc) — decision-log.md 2026-09-09 #20 punto 3, no hay columna nueva.
  async regenerateSegmentByIndex(episodeId: string, sequenceIndex: number): Promise<AudioAsset> {
    const ordered = await this.getOrderedOfficialArguments(episodeId);
    const argument = ordered[sequenceIndex - 1];
    if (!argument) throw new SequenceIndexOutOfRangeError(episodeId, sequenceIndex, ordered.length);

    const previousAudioAssetId = argument.audioAssetId;
    const created = await this.synthesizeAndSave(episodeId, argument);

    // Atomicidad de AC 6.2 = swap de FK (decision-log.md #20 punto 3), no un
    // UPDATE in-place del AudioAsset viejo: el nuevo AudioAsset ya existe
    // antes de tocar el Argument, así que un fallo a mitad de camino nunca
    // deja al Argument sin audioAssetId válido.
    await this.prisma.argument.update({ where: { id: argument.id }, data: { audioAssetId: created.id } });

    // Cleanup del AudioAsset/archivo previos — best-effort, después del swap.
    // Si falla (ej. el archivo ya no estaba), el segmento ya quedó
    // regenerado igual: no hace falta revertir nada (AudioStorageProvider.
    // delete() ya no lanza si el archivo no existe).
    if (previousAudioAssetId) {
      const previous = await this.prisma.audioAsset.findUnique({ where: { id: previousAudioAssetId } });
      if (previous) {
        await this.storage.delete(previous.storageKey);
        await this.prisma.audioAsset.delete({ where: { id: previousAudioAssetId } }).catch(() => undefined);
      }
    }

    return created;
  }

  // AC 6.1: URL firmada de corta duración para UN AudioAsset, scopeado al
  // episodio pedido (findFirstOrThrow tira Prisma P2025 si el audioAssetId
  // no pertenece a este episodio — HttpErrorFilter ya lo mapea a 404, mismo
  // criterio que el resto de los lookups de EpisodesModule).
  async getSignedAudioUrl(episodeId: string, audioAssetId: string): Promise<{ url: string }> {
    const episode = await this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId }, select: { debateId: true } });
    const argument = await this.prisma.argument.findFirstOrThrow({
      where: { audioAssetId, debateRound: { debateId: episode.debateId } },
      include: { audioAsset: true },
    });
    if (!argument.audioAsset) {
      throw new Error(`Argument ${argument.id} referencia audioAssetId ${audioAssetId} pero la relación no resolvió — inconsistencia de datos.`);
    }
    const url = await this.storage.getSignedUrl(argument.audioAsset.storageKey);
    return { url };
  }

  private async synthesizeAndSave(episodeId: string, argument: ArgumentWithAgent): Promise<AudioAsset> {
    const activeProvider = this.config.get("TTS_PROVIDER", { infer: true });
    const voiceMap = argument.agent.voiceId as unknown as VoiceIdMap;
    const voiceId = voiceMap[activeProvider];

    const { audioBuffer, durationMs, mimeType } = await this.provider.synthesize(argument.content, voiceId);
    const extension = MIME_EXTENSIONS[mimeType] ?? "bin";
    const audioAssetId = randomUUID();
    const storageKey = `${episodeId}/${audioAssetId}.${extension}`;

    await this.storage.save(storageKey, audioBuffer);
    return this.prisma.audioAsset.create({
      data: { id: audioAssetId, storageKey, provider: activeProvider, durationMs, mimeType },
    });
  }
}
