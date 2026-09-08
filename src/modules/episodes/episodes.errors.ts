import { EpisodeStatus } from "@prisma/client";

// Excepción tipada (coding-rules.md §5) — EpisodeStateService es el único
// escritor de Episode.status; cualquier transición fuera de su ALLOWED_FROM
// tira esto en vez de mutar el status de todas formas. El controller la
// mapea a 409 INVALID_STATE_TRANSITION (api-contract.md §5).
export class InvalidEpisodeTransitionError extends Error {
  constructor(
    public readonly currentStatus: EpisodeStatus,
    public readonly attempted: string
  ) {
    super(`No se puede pasar a "${attempted}" desde el estado actual "${currentStatus}".`);
    this.name = "InvalidEpisodeTransitionError";
  }
}

// AC 2.1 (features.md Feature 2): el orquestador chequea EpisodeUsage contra
// los techos configurados en Episode ANTES de cada llamada externa. Superar
// el presupuesto no es un error de sistema, es una decisión de negocio que
// el curador resuelve vía la acción `resume` (ampliar el límite) o `reject`.
export class BudgetExceededError extends Error {
  constructor(
    public readonly reason: "USAGE_LIMIT_EXCEEDED",
    public readonly metric: "llmCalls" | "searchRequests",
    public readonly limit: number
  ) {
    super(`Se alcanzó el límite de ${metric} (${limit}) configurado para este episodio.`);
    this.name = "BudgetExceededError";
  }
}

// Señal de control interna (architecture.md §7.3): processDraft ya dejó el
// Argument en REJECTED y transicionó el Episode a REQUIRES_HUMAN_REVIEW
// (reason: MAX_REVISIONS_EXCEEDED) él mismo — esto solo corta el loop de
// rondas sin que handlePipelineError intente mapearla a otra transición.
export class EpisodePipelineHaltedError extends Error {
  constructor(public readonly episodeId: string) {
    super(`Pipeline del episodio ${episodeId} detenido — la transición de estado ya fue aplicada.`);
    this.name = "EpisodePipelineHaltedError";
  }
}
