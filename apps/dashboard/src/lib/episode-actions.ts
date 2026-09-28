import { API_ERROR_CODES } from "@/lib/api/error-codes";
import { ApiError, errorMessage } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import type { EpisodeDetail } from "@/lib/episode-detail";
import type { EpisodeStatus } from "@/lib/episode-status";

// Acciones de curaduría del detalle (spec 003, secciones 6 y 7), sin React,
// para poder testearlas sin DOM. Una operación tipada por acción desde
// API-10 (api-contract.md §3); regenerate-audio es de la F3.

export type CurationAction = "approve" | "edit" | "regenerate" | "regenerate-verdict" | "reject" | "resume";

export type ResumeBody = components["schemas"]["ResumeActionBodyDto"];

/** Lo que recibe la mutación única del detalle: una acción y su body. */
export type EpisodeActionRequest =
  | { action: "approve" }
  | { action: "reject" }
  | { action: "edit"; argumentId: string; content: string }
  | { action: "regenerate"; argumentId: string }
  | { action: "regenerate-verdict" }
  | { action: "resume"; body: ResumeBody };

/**
 * Acciones válidas por estado (api-contract.md §5 y API-19; "Mapeo de
 * estados a UI"). Record para que un estado nuevo en la API obligue a
 * decidir. AC 3.42: fuera de estos estados los controles no se muestran.
 */
const ACTIONS_BY_STATUS: Readonly<Record<EpisodeStatus, readonly CurationAction[]>> = {
  CREATED: [],
  RESEARCHING: [],
  READY_FOR_DEBATE: [],
  DEBATING: [],
  JUDGING: [],
  PENDING_REVIEW: ["approve", "edit", "regenerate", "regenerate-verdict", "reject"],
  REQUIRES_HUMAN_REVIEW: ["resume", "reject"],
  APPROVED: [],
  GENERATING_AUDIO: [],
  READY_FOR_RENDER: [],
  RENDERING: [],
  COMPLETED: [],
  CANCELLED: [],
  FAILED: [],
};

export function availableActions(status: EpisodeStatus): readonly CurationAction[] {
  return ACTIONS_BY_STATUS[status];
}

export function canRunAction(status: EpisodeStatus, action: CurationAction): boolean {
  return ACTIONS_BY_STATUS[status].includes(action);
}

export interface LlmBudget {
  used: number;
  limit: number;
  /** `usage.llmCalls >= limits.maxLlmCalls` (AC 3.46, AC 3.83). */
  exhausted: boolean;
}

/**
 * Presupuesto de llamadas LLM del episodio. Con `usage` null no hay consumo
 * registrado: se cuenta como 0 usadas.
 */
export function llmBudget(detail: Pick<EpisodeDetail, "usage" | "limits">): LlmBudget {
  const used = detail.usage?.llmCalls ?? 0;
  const limit = detail.limits.maxLlmCalls;
  return { used, limit, exhausted: used >= limit };
}

/** Consumo para las confirmaciones (AC 3.82): "usadas 12 de 25". */
export function llmBudgetSummary(budget: LlmBudget): string {
  return `Llamadas LLM usadas: ${budget.used} de ${budget.limit}.`;
}

/**
 * Explicación a la vista de un "Regenerar" o "Volver a juzgar"
 * deshabilitados (AC 3.46, AC 3.83): en PENDING_REVIEW no hay forma de subir
 * los límites, así que la llamada fallaría seguro.
 */
export function llmBudgetExhaustedExplanation(budget: LlmBudget): string {
  return `Se agotó el presupuesto de llamadas LLM del episodio (${budget.used} de ${budget.limit}). En esta etapa no se puede subir el límite, así que no se puede regenerar ni volver a juzgar.`;
}

export interface EditDraftState {
  /** Lo que se envía: el texto sin espacios al principio ni al final. */
  value: string;
  /** Hay cambios respecto del original (Cancelar pide confirmación, AC 3.44). */
  dirty: boolean;
  /** "Guardar" se habilita si el texto no queda vacío ni igual al original (AC 3.44). */
  canSave: boolean;
}

export function editDraftState(original: string, draft: string): EditDraftState {
  const value = draft.trim();
  return { value, dirty: draft !== original, canSave: value.length > 0 && value !== original.trim() };
}

// Mensajes de la spec (AC 3.48, AC 3.50, AC 3.85).
export const STATE_CHANGED_MESSAGE = "El episodio cambió de estado; se actualizó la vista.";
export const LLM_BUDGET_ERROR_MESSAGE = "Se agotó el presupuesto de llamadas LLM del episodio.";
export const PROVIDER_QUOTA_ERROR_MESSAGE = "El proveedor de IA no está disponible o agotó su cuota; probá más tarde.";
export const ARGUMENT_NOT_FOUND_MESSAGE = "El argumento ya no está en el debate; se actualizó la vista.";
export const EPISODE_NOT_FOUND_MESSAGE = "El episodio ya no existe.";

const ACTION_FAILURE_LABELS: Readonly<Record<CurationAction, string>> = {
  approve: "No se pudo aprobar el episodio.",
  edit: "No se pudo guardar la edición.",
  regenerate: "No se pudo regenerar el argumento.",
  "regenerate-verdict": "No se pudo volver a juzgar.",
  reject: "No se pudo rechazar el episodio.",
  resume: "No se pudo reanudar el episodio.",
};

/**
 * Cómo se muestra el error de una acción:
 * - `state-changed`: 409 INVALID_STATE_TRANSITION; se refresca el detalle y
 *   se avisa arriba de la pantalla, porque los controles pueden desaparecer
 *   con el estado nuevo (AC 3.48, AC 3.85).
 * - `not-found`: 404; se refresca el detalle (AC 3.50, API-14).
 * - `validation`: 400 VALIDATION_ERROR, dentro del formulario sin perder lo
 *   cargado (AC 3.54).
 * - `error`: mensaje específico (AC 3.50, AC 3.85) o error genérico.
 * En todos los casos los datos quedan como estaban: la vista no cambia
 * nada hasta el refetch (D7).
 */
export type ActionErrorView =
  | { kind: "state-changed"; message: string }
  | { kind: "not-found"; message: string }
  | { kind: "validation"; message: string }
  | { kind: "error"; message: string };

/** Acciones sincrónicas que llaman al LLM (API-10b): tienen mensajes propios. */
function callsLlm(action: CurationAction): boolean {
  return action === "regenerate" || action === "regenerate-verdict";
}

/**
 * El mensaje de un VALIDATION_ERROR de Zod llega como "<campo>: <mensaje>" o
 * ": <mensaje>" sin campo (api-contract.md §1). Se muestra tal cual, sin el
 * ": " inicial.
 */
export function validationErrorText(message: string): string {
  const trimmed = message.trim();
  return trimmed.startsWith(":") ? trimmed.slice(1).trim() : trimmed;
}

export function actionErrorView(action: CurationAction, error: unknown): ActionErrorView {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.code === API_ERROR_CODES.INVALID_STATE_TRANSITION) {
      return { kind: "state-changed", message: STATE_CHANGED_MESSAGE };
    }
    if (error.status === 404 && error.code === API_ERROR_CODES.NOT_FOUND) {
      const argumentAction = action === "edit" || action === "regenerate";
      return { kind: "not-found", message: argumentAction ? ARGUMENT_NOT_FOUND_MESSAGE : EPISODE_NOT_FOUND_MESSAGE };
    }
    if (callsLlm(action) && error.status === 409 && error.code === API_ERROR_CODES.USAGE_LIMIT_EXCEEDED) {
      return { kind: "error", message: LLM_BUDGET_ERROR_MESSAGE };
    }
    if (callsLlm(action) && error.status === 503 && error.code === API_ERROR_CODES.PROVIDER_QUOTA_EXCEEDED) {
      return { kind: "error", message: PROVIDER_QUOTA_ERROR_MESSAGE };
    }
    if (error.status === 400 && error.code === API_ERROR_CODES.VALIDATION_ERROR) {
      return { kind: "validation", message: validationErrorText(error.message) || error.message };
    }
  }
  return { kind: "error", message: `${ACTION_FAILURE_LABELS[action]} ${errorMessage(error)}` };
}

/** Tras un 409 de transición o un 404 se refresca el detalle (AC 3.48, AC 3.50). */
export function refetchesAfterError(view: ActionErrorView): boolean {
  return view.kind === "state-changed" || view.kind === "not-found";
}

/** La acción en curso involucra este argumento ("Regenerando…", editor ocupado). */
export function isArgumentAction(request: EpisodeActionRequest | undefined, argumentId: string): boolean {
  return (
    request !== undefined &&
    (request.action === "edit" || request.action === "regenerate") &&
    request.argumentId === argumentId
  );
}

export interface ReviewControls {
  budget: LlmBudget;
  /**
   * "Regenerar" y "Volver a juzgar" habilitados: con el presupuesto LLM
   * agotado se deshabilitan, con la explicación a la vista (AC 3.46, AC 3.83).
   */
  llmActionsEnabled: boolean;
  /**
   * Veredicto desactualizado (AC 3.81): "Volver a juzgar" se destaca
   * (AC 3.82) y la confirmación de "Aprobar" lo advierte (AC 3.84).
   */
  staleVerdict: boolean;
}

/**
 * Controles de curaduría de PENDING_REVIEW (sección 6), o null en cualquier
 * otro estado: ahí no se muestran, no alcanza con deshabilitarlos (AC 3.42).
 */
export function reviewControls(detail: Pick<EpisodeDetail, "status" | "usage" | "limits" | "debate">): ReviewControls | null {
  if (detail.status !== "PENDING_REVIEW") return null;
  const budget = llmBudget(detail);
  return {
    budget,
    llmActionsEnabled: !budget.exhausted,
    staleVerdict: detail.debate.verdict?.stale === true,
  };
}

/** Advertencia de la confirmación de "Aprobar" con el veredicto desactualizado (AC 3.84). */
export const APPROVE_STALE_VERDICT_WARNING = "El veredicto es anterior a tus cambios y es el que se va a publicar.";

/** Edge case "Presupuesto agotado en PENDING_REVIEW": la confirmación de "Regenerar" lo avisa. */
export function lastLlmCallWarning(budget: LlmBudget): string | null {
  return budget.limit - budget.used === 1
    ? "Es la última llamada LLM del presupuesto: después no vas a poder regenerar otro argumento ni volver a juzgar."
    : null;
}
