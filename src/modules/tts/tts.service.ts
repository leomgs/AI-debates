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
// Etapa 2 de TTS (tasks.md sección 5): synthesizeSegment()/
// getOrderedOfficialArguments() alcanzan para el camino crítico Local
// end-to-end. regenerateSegment() (AC 6.2) se agrega en la etapa 3.
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
    const activeProvider = this.config.get("TTS_PROVIDER", { infer: true });
    const voiceMap = argument.agent.voiceId as unknown as VoiceIdMap;
    const voiceId = voiceMap[activeProvider];

    const { audioBuffer, durationMs, mimeType } = await this.provider.synthesize(argument.content, voiceId);
    const extension = MIME_EXTENSIONS[mimeType] ?? "bin";
    const audioAssetId = randomUUID();
    const storageKey = `${episodeId}/${audioAssetId}.${extension}`;

    await this.storage.save(storageKey, audioBuffer);
    const audioAsset = await this.prisma.audioAsset.create({
      data: { id: audioAssetId, storageKey, provider: activeProvider, durationMs, mimeType },
    });
    await this.prisma.argument.update({ where: { id: argument.id }, data: { audioAssetId: audioAsset.id } });

    return audioAsset;
  }
}
