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
