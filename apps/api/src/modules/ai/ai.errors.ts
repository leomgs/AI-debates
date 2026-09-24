// Excepción tipada (coding-rules.md §5) — no un null/undefined silencioso.
// Solo EpisodesModule la captura y decide la transición a
// REQUIRES_HUMAN_REVIEW con reason: PROVIDER_QUOTA_EXCEEDED (distinto de
// USAGE_LIMIT_EXCEEDED, que es el presupuesto propio del episodio).
export class DailyQuotaExceededError extends Error {
  constructor(provider: string, limit: number) {
    super(`Se alcanzó el límite diario de ${limit} requests para el provider ${provider}.`);
    this.name = "DailyQuotaExceededError";
  }
}

// Cap defensivo de acquire() superado (RPM real requeriría esperar más de lo
// razonable) — señal de un bug o de un límite mal configurado, no un caso
// esperado en operación normal.
export class RateLimitWaitExceededError extends Error {
  constructor(provider: string, waitMs: number, capMs: number) {
    super(
      `El rate limiter de ${provider} calculó una espera de ${waitMs}ms, por encima del cap defensivo de ${capMs}ms.`
    );
    this.name = "RateLimitWaitExceededError";
  }
}
