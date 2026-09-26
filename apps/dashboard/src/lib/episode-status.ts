import type { components } from "@/lib/api/schema";

// Mapeo de los 14 EpisodeStatus a UI (spec 003, "Mapeo de estados a UI").
// El tipo sale de openapi.json (D5): si la API suma, quita o renombra un
// estado, este Record deja de compilar y el build del dashboard falla.
export type EpisodeStatus = components["schemas"]["EpisodeDto_Output"]["status"];

/** Tratamiento visual (color semántico, no un color concreto). */
export type StatusCategory = "neutral" | "in-progress" | "attention" | "ready" | "cancelled" | "error";

/** Grupo de la lista /studio (AC 3.16). */
export type StudioGroup = "requires-action" | "in-progress" | "finished";

/**
 * Cómo se entera el detalle de un cambio: SSE (con refetch, D7), polling del
 * detalle (D19) o ninguno (pipeline frenado o terminado). SSE y polling solo
 * corren si además `pipelineActive` es true (API-12; AC 3.39).
 */
export type StatusUpdateMode = "sse" | "polling" | "none";

export interface EpisodeStatusUi {
  label: string;
  category: StatusCategory;
  group: StudioGroup;
  /** Terminal según la spec. READY_FOR_RENDER no lo es (hasta Feature 9 lo es en la práctica). */
  terminal: boolean;
  updates: StatusUpdateMode;
}

export const EPISODE_STATUS_UI: Readonly<Record<EpisodeStatus, EpisodeStatusUi>> = {
  CREATED: { label: "Creado", category: "neutral", group: "in-progress", terminal: false, updates: "sse" },
  RESEARCHING: { label: "Investigando", category: "in-progress", group: "in-progress", terminal: false, updates: "sse" },
  READY_FOR_DEBATE: {
    label: "Listo para debatir",
    category: "in-progress",
    group: "in-progress",
    terminal: false,
    updates: "sse",
  },
  DEBATING: { label: "Debatiendo", category: "in-progress", group: "in-progress", terminal: false, updates: "sse" },
  JUDGING: { label: "Juzgando", category: "in-progress", group: "in-progress", terminal: false, updates: "sse" },
  PENDING_REVIEW: {
    label: "Esperando revisión",
    category: "attention",
    group: "requires-action",
    terminal: false,
    updates: "none",
  },
  REQUIRES_HUMAN_REVIEW: {
    label: "Requiere intervención",
    category: "attention",
    group: "requires-action",
    terminal: false,
    updates: "none",
  },
  APPROVED: { label: "Aprobado", category: "in-progress", group: "in-progress", terminal: false, updates: "polling" },
  GENERATING_AUDIO: {
    label: "Generando audio",
    category: "in-progress",
    group: "in-progress",
    terminal: false,
    updates: "polling",
  },
  READY_FOR_RENDER: { label: "Listo", category: "ready", group: "finished", terminal: false, updates: "none" },
  RENDERING: { label: "Renderizando", category: "in-progress", group: "in-progress", terminal: false, updates: "polling" },
  COMPLETED: { label: "Completado", category: "ready", group: "finished", terminal: true, updates: "none" },
  CANCELLED: { label: "Cancelado", category: "cancelled", group: "finished", terminal: true, updates: "none" },
  FAILED: { label: "Falló", category: "error", group: "finished", terminal: true, updates: "none" },
};

export const STUDIO_GROUP_LABELS: Readonly<Record<StudioGroup, string>> = {
  "requires-action": "Requiere acción",
  "in-progress": "En curso",
  finished: "Terminados",
};

/** Orden de los grupos en /studio: primero lo que requiere acción (US 3.1). */
export const STUDIO_GROUP_ORDER: readonly StudioGroup[] = ["requires-action", "in-progress", "finished"];

export function episodeStatusUi(status: EpisodeStatus): EpisodeStatusUi {
  return EPISODE_STATUS_UI[status];
}
