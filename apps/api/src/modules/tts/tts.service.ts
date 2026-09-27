import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Agent, AgentVoice, AudioAsset, DebateLanguage, Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../shared/prisma/prisma.service";
import type { Env } from "../../shared/config/env.schema";
import type { AudioProvider } from "./audio-provider.interface";
import type { AudioStorageProvider } from "./audio-storage.interface";
import { AUDIO_PROVIDER, AUDIO_STORAGE } from "./tts.tokens";
import { SequenceIndexOutOfRangeError, VoiceNotConfiguredError } from "./tts.errors";

// Include del Agent con las voces que puede usar resolveVoiceId. Trae todas
// las filas del agente (a lo sumo idiomas × proveedores): el idioma lo elige
// resolveVoiceId con el del episodio, no el include (spec 004, paso 13.6).
// Exportado para que EpisodesService.getManifest cargue el agente igual que
// acá.
export const AGENT_WITH_VOICES_INCLUDE = {
  voices: true,
} satisfies Prisma.AgentInclude;

// Lo mínimo que necesita resolveVoiceId: las voces del agente y con qué
// nombrarlo en el error si falta la suya.
export type AgentWithVoices = Pick<Agent, "name" | "role"> & {
  voices: Pick<AgentVoice, "language" | "provider" | "voiceId">[];
};

// Rótulo de un agente en VoiceNotConfiguredError: nombre y rol, para que el
// mensaje sirva tanto para ubicar la fila Agent como la persona.
function agentLabel(agent: Pick<Agent, "name" | "role">): string {
  return agent.role ? `${agent.name} (${agent.role})` : agent.name;
}

// audioAsset incluido para Feature 7 (RenderModule reusa este método vía
// EpisodesService para leer durationMs/subtitles ya persistidos, sin query
// propia — mismo orden/set que sequenceIndex de AC 6.2).
const ARGUMENT_WITH_AGENT_INCLUDE = {
  agent: { include: AGENT_WITH_VOICES_INCLUDE },
  audioAsset: true,
} satisfies Prisma.ArgumentInclude;
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
  // fila de AgentVoice usar (una por idioma y proveedor, ADR 0002) se
  // resuelven acá, no en el caller.
  // `language` es el Episode.language que lee el caller (spec 004, regla de
  // flujo del idioma: los puntos de entrada lo leen de la base y los
  // módulos de dominio lo reciben por parámetro).
  async synthesizeSegment(episodeId: string, argument: ArgumentWithAgent, language: DebateLanguage): Promise<AudioAsset> {
    const created = await this.synthesizeAndSave(episodeId, argument, language);
    await this.prisma.argument.update({ where: { id: argument.id }, data: { audioAssetId: created.id } });
    return created;
  }

  // AC 6.2 (features.md Feature 6): regenera el audio de un único
  // sequenceIndex sin alterar el resto del episodio. sequenceIndex es
  // 1-based sobre el mismo orden que getOrderedOfficialArguments (createdAt
  // asc) — decision-log.md 2026-09-09 #20 punto 3, no hay columna nueva.
  async regenerateSegmentByIndex(episodeId: string, sequenceIndex: number, language: DebateLanguage): Promise<AudioAsset> {
    const ordered = await this.getOrderedOfficialArguments(episodeId);
    const argument = ordered[sequenceIndex - 1];
    if (!argument) throw new SequenceIndexOutOfRangeError(episodeId, sequenceIndex, ordered.length);

    const previousAudioAssetId = argument.audioAssetId;
    // Sin voz, VoiceNotConfiguredError sale de synthesizeAndSave antes de
    // sintetizar ni escribir nada: el segmento queda como estaba (spec 004,
    // AC 4.15).
    const created = await this.synthesizeAndSave(episodeId, argument, language);

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

  // Voz de un agente para el idioma del episodio y el proveedor activo
  // (ADR 0002 punto 4). Pública porque EpisodesService.getManifest la usa
  // para los agentes sin AudioAsset.voiceId (spec 004, D17), sin duplicar
  // esta resolución fuera de TtsService. Recibe las voces que carga
  // AGENT_WITH_VOICES_INCLUDE. Sin fila no hay respaldo: devolver undefined
  // haría que Echogarden elija otra voz sin avisar (D14).
  resolveVoiceId(agent: AgentWithVoices, language: DebateLanguage): string {
    const activeProvider = this.activeProvider();
    const voice = agent.voices.find((v) => v.language === language && v.provider === activeProvider);
    if (!voice) throw new VoiceNotConfiguredError(language, activeProvider, [agentLabel(agent)]);
    return voice.voiceId;
  }

  // Spec 004, D15 (ADR 0002 punto 4): createEpisode la llama antes del
  // primer insert, con los agentes candidatos. `unresolvedRoles` son los
  // roles candidatos sin fila Agent: cuentan como agentes sin voz y el
  // error los nombra por su rol. Un solo error con todos los faltantes, para
  // que el curador sepa de una vez qué hay que cargar.
  async assertVoicesConfigured(
    agentIds: readonly string[],
    language: DebateLanguage,
    unresolvedRoles: readonly string[] = []
  ): Promise<void> {
    const activeProvider = this.activeProvider();
    const agents = await this.prisma.agent.findMany({
      where: { id: { in: [...agentIds] } },
      select: {
        id: true,
        name: true,
        role: true,
        voices: { where: { language, provider: activeProvider }, select: { voiceId: true } },
      },
    });

    const missing: string[] = [];
    for (const agentId of agentIds) {
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) missing.push(agentId);
      else if (agent.voices.length === 0) missing.push(agentLabel(agent));
    }
    missing.push(...unresolvedRoles.map((role) => `rol ${role} (sin fila Agent)`));

    if (missing.length > 0) throw new VoiceNotConfiguredError(language, activeProvider, missing);
  }

  // Proveedor cuya voz se busca en AgentVoice. Mientras Echogarden sea el
  // único motor, EnvSchema no deja arrancar con otro valor que LOCAL (spec
  // 004, D16): la clave de la voz y el motor enlazado en TtsModule salen de
  // la misma fuente.
  private activeProvider(): Env["TTS_PROVIDER"] {
    return this.config.get("TTS_PROVIDER", { infer: true });
  }

  private async synthesizeAndSave(episodeId: string, argument: ArgumentWithAgent, language: DebateLanguage): Promise<AudioAsset> {
    const activeProvider = this.activeProvider();
    const voiceId = this.resolveVoiceId(argument.agent, language);

    const { audioBuffer, durationMs, mimeType, subtitles } = await this.provider.synthesize(argument.content, voiceId);
    const extension = MIME_EXTENSIONS[mimeType] ?? "bin";
    const audioAssetId = randomUUID();
    const storageKey = `${episodeId}/${audioAssetId}.${extension}`;

    await this.storage.save(storageKey, audioBuffer);
    return this.prisma.audioAsset.create({
      data: {
        id: audioAssetId,
        storageKey,
        provider: activeProvider,
        durationMs,
        mimeType,
        // ADR 0002 punto 6: la voz realmente usada. El manifest la toma de
        // acá (spec 004, D17, AC 4.16).
        voiceId,
        subtitles: (subtitles as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      },
    });
  }
}
