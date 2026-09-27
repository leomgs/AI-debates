// Excepciones tipadas (coding-rules.md §5) — no un null/undefined silencioso.
// Solo EpisodesModule las captura (etapa 2 de TTS, EpisodeOrchestratorService)
// y decide la transición: TtsProviderUnavailableError -> REQUIRES_HUMAN_REVIEW
// con reason PROVIDER_QUOTA_EXCEEDED (mismo reason que ya usa
// DailyQuotaExceededError/RateLimitWaitExceededError de ai.errors.ts — no
// hace falta uno nuevo, ambos significan "el proveedor externo no pudo
// resolver la llamada").
export class TtsProviderUnavailableError extends Error {
  constructor(provider: string, cause?: unknown) {
    super(`El proveedor de TTS "${provider}" no pudo generar el audio.`);
    this.name = "TtsProviderUnavailableError";
    this.cause = cause;
  }
}

// AC 6.2 — regenerateSegment() (etapa 3) recibe un sequenceIndex que no
// corresponde a ningún Argument OFFICIAL del episodio.
export class SequenceIndexOutOfRangeError extends Error {
  constructor(episodeId: string, sequenceIndex: number, total: number) {
    super(`sequenceIndex ${sequenceIndex} fuera de rango para el episodio ${episodeId} (hay ${total} segmento(s) OFFICIAL).`);
    this.name = "SequenceIndexOutOfRangeError";
  }
}

// Spec 004, D15 (ADR 0002 punto 4): falta la fila de AgentVoice de uno o más
// agentes para el idioma pedido y el proveedor activo. Nunca hay respaldo con
// otra voz (D14). Solo EpisodesModule decide qué hacer con esto: 409
// VOICE_NOT_CONFIGURED en HTTP (createEpisode, regenerate-audio, manifest) y
// REQUIRES_HUMAN_REVIEW con el CheckpointReason VOICE_NOT_CONFIGURED en el
// pipeline. `agents` lleva un rótulo legible por agente sin voz (nombre y
// rol, o solo el rol si falta la fila Agent de un rol candidato).
export class VoiceNotConfiguredError extends Error {
  constructor(
    public readonly language: string,
    public readonly provider: string,
    public readonly agents: readonly string[]
  ) {
    super(
      `No hay voz configurada en idioma ${language} para el proveedor de TTS "${provider}" (tabla AgentVoice). Agentes sin voz: ${agents.join(", ")}.`
    );
    this.name = "VoiceNotConfiguredError";
  }
}
