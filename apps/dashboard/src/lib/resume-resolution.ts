import type { components } from "@/lib/api/schema";
import type { CheckpointReason } from "@/lib/checkpoint-reasons";
import type { Checkpoint, EpisodeDetail, Participant } from "@/lib/episode-detail";
import type { UsageMetricKey } from "@/lib/usage";

// Resolución de REQUIRES_HUMAN_REVIEW (spec 003, sección 7; AC 3.51-3.55),
// sin React. El checkpoint activo es el más reciente (latestCheckpoint, el
// mismo criterio que `resume` en el backend). Los bodies salen de los tipos
// generados (D5); lo que el JSON Schema no expresa (el "al menos un límite"
// de UsageLimitResumeBody, que en el backend es un .refine) se valida acá.

export type UsageLimitResumeBody = components["schemas"]["UsageLimitResumeBody"];
export type InsufficientEvidenceResumeBody = components["schemas"]["InsufficientEvidenceResumeBody"];
export type EmptyResumeBody = components["schemas"]["EmptyResumeBody"];

/**
 * Qué panel corresponde a cada motivo (tabla de AC 3.51):
 * - `usage-limit`: formulario de límites.
 * - `insufficient-evidence`: formulario de fuentes manuales.
 * - `empty`: "Reanudar" con body `{}`.
 * - `blocked`: "Reanudar" deshabilitado con explicación; solo "Rechazar" (D13).
 * - `unknown`: motivo no contemplado; panel genérico con solo "Rechazar" (AC 3.55).
 */
export type ResolutionKind = "usage-limit" | "insufficient-evidence" | "empty" | "blocked" | "unknown";

const RESOLUTION_BY_REASON: Readonly<Record<CheckpointReason, Exclude<ResolutionKind, "unknown">>> = {
  USAGE_LIMIT_EXCEEDED: "usage-limit",
  INSUFFICIENT_EVIDENCE: "insufficient-evidence",
  MAX_REVISIONS_EXCEEDED: "empty",
  VALIDATION_INCONSISTENCY: "blocked",
  PROVIDER_QUOTA_EXCEEDED: "empty",
  VOICE_NOT_CONFIGURED: "empty",
};

export function isKnownReason(reason: string): reason is CheckpointReason {
  return Object.hasOwn(RESOLUTION_BY_REASON, reason);
}

export function resolutionKind(reason: string): ResolutionKind {
  return isKnownReason(reason) ? RESOLUTION_BY_REASON[reason] : "unknown";
}

/** Body `{}` de los motivos sin nada que mandar (api-contract.md §3). */
export const EMPTY_RESUME_BODY: EmptyResumeBody = {};

export const REPEAT_REASON_WARNING =
  "Si tras reanudar vuelve a ocurrir este mismo motivo, en cualquier fase, antes de que ocurra un motivo distinto, el episodio pasa a Falló y no se puede recuperar.";

const REPEAT_REASON_EXTRA: Readonly<Partial<Record<CheckpointReason, string>>> = {
  PROVIDER_QUOTA_EXCEEDED: "Reanudar antes de que el proveedor se recupere gasta ese único reintento.",
  VOICE_NOT_CONFIGURED: "Reanudar sin haber corregido las voces gasta ese único reintento igual.",
};

/** Aviso junto a todo "Reanudar" habilitado (AC 3.52), con el agregado por motivo. */
export function repeatReasonWarning(reason: CheckpointReason): string[] {
  const extra = REPEAT_REASON_EXTRA[reason];
  return extra === undefined ? [REPEAT_REASON_WARNING] : [REPEAT_REASON_WARNING, extra];
}

// --- USAGE_LIMIT_EXCEEDED ---

type Usage = NonNullable<EpisodeDetail["usage"]>;
type Limits = EpisodeDetail["limits"];

const LIMIT_OF_METRIC: Readonly<Record<UsageMetricKey, keyof Limits>> = {
  llmCalls: "maxLlmCalls",
  searchRequests: "maxSearchQueries",
  ttsRequests: "maxTtsSegments",
};

export const USAGE_METRIC_LABELS: Readonly<Record<UsageMetricKey, string>> = {
  llmCalls: "Llamadas LLM",
  searchRequests: "Búsquedas",
  ttsRequests: "Segmentos TTS",
};

export interface ExhaustedMetric {
  key: UsageMetricKey;
  used: number;
  limit: number;
}

/**
 * Métricas que llegaron al límite (`used >= limit`, el mismo criterio del
 * backend al reservar presupuesto). Con `usage` null no hay consumo.
 */
export function exhaustedMetrics(usage: Usage | null, limits: Limits): ExhaustedMetric[] {
  if (usage === null) return [];
  return (Object.keys(LIMIT_OF_METRIC) as UsageMetricKey[])
    .map((key) => ({ key, used: usage[key], limit: limits[LIMIT_OF_METRIC[key]] }))
    .filter((metric) => metric.used >= metric.limit);
}

/**
 * - `form`: se pueden subir `maxLlmCalls` y/o `maxSearchQueries`.
 * - `tts-reject-only`: la métrica agotada es `ttsRequests` y todavía no se
 *   puede subir `maxTtsSegments` (API-16): solo "Rechazar" (AC 3.51). Se
 *   reconoce por la fase (en GENERATING_AUDIO solo se consume TTS) o porque
 *   la única métrica agotada es la de TTS.
 */
export type UsageLimitMode = "form" | "tts-reject-only";

export function usageLimitMode(
  detail: Pick<EpisodeDetail, "usage" | "limits">,
  checkpoint: Pick<Checkpoint, "fromState">,
): UsageLimitMode {
  if (checkpoint.fromState === "GENERATING_AUDIO") return "tts-reject-only";
  const exhausted = exhaustedMetrics(detail.usage, detail.limits).map((metric) => metric.key);
  const onlyTts = exhausted.includes("ttsRequests") && !exhausted.includes("llmCalls") && !exhausted.includes("searchRequests");
  return onlyTts ? "tts-reject-only" : "form";
}

export type UsageLimitField = keyof UsageLimitResumeBody;

/** Campos del formulario, en el orden en que se muestran. */
export const USAGE_LIMIT_FIELDS: ReadonlyArray<{ field: UsageLimitField; metric: UsageMetricKey; label: string }> = [
  { field: "maxLlmCalls", metric: "llmCalls", label: "Límite de llamadas LLM" },
  { field: "maxSearchQueries", metric: "searchRequests", label: "Límite de búsquedas" },
];

export type UsageLimitFormValues = Record<UsageLimitField, string>;

/** Precargado con los límites actuales (AC 3.51). */
export function initialUsageLimitValues(limits: Limits): UsageLimitFormValues {
  return { maxLlmCalls: String(limits.maxLlmCalls), maxSearchQueries: String(limits.maxSearchQueries) };
}

export interface UsageLimitValidation {
  /** null mientras el formulario no sea válido: no se puede enviar (AC 3.53). */
  body: UsageLimitResumeBody | null;
  fieldErrors: Partial<Record<UsageLimitField, string>>;
  formError: string | null;
}

const INTEGER_PATTERN = /^\d+$/;

/**
 * Valida el formulario de límites (AC 3.51, AC 3.53):
 * - Cada valor es un entero positivo mayor que el consumo actual de su
 *   métrica: un límite menor o igual volvería a frenar por el mismo motivo
 *   y mandaría el episodio a Falló (edge case "Límite nuevo menor o igual al
 *   consumo").
 * - Un campo vacío o igual al límite actual no se manda. El de una métrica
 *   agotada no puede quedar vacío: sin subirlo, reanudar repite el motivo.
 * - El body lleva al menos un límite (el .refine del backend que el tipo
 *   generado no expresa).
 */
export function validateUsageLimitForm(
  values: UsageLimitFormValues,
  detail: Pick<EpisodeDetail, "usage" | "limits">,
): UsageLimitValidation {
  const fieldErrors: Partial<Record<UsageLimitField, string>> = {};
  const body: UsageLimitResumeBody = {};

  for (const { field, metric } of USAGE_LIMIT_FIELDS) {
    const raw = values[field].trim();
    const used = detail.usage?.[metric] ?? 0;
    const current = detail.limits[LIMIT_OF_METRIC[metric]];
    const exhausted = used >= current;

    if (raw === "") {
      if (exhausted) fieldErrors[field] = "Este límite se agotó: subilo para poder reanudar.";
      continue;
    }
    if (!INTEGER_PATTERN.test(raw)) {
      fieldErrors[field] = "Tiene que ser un número entero positivo.";
      continue;
    }
    const value = Number(raw);
    if (!Number.isSafeInteger(value)) {
      fieldErrors[field] = "El número es demasiado grande.";
      continue;
    }
    if (value <= 0) {
      fieldErrors[field] = "Tiene que ser un número entero positivo.";
      continue;
    }
    if (value <= used) {
      fieldErrors[field] = `Tiene que ser mayor que el consumo actual (${used}).`;
      continue;
    }
    if (value !== current) body[field] = value;
  }

  if (Object.keys(fieldErrors).length > 0) return { body: null, fieldErrors, formError: null };
  if (body.maxLlmCalls === undefined && body.maxSearchQueries === undefined) {
    return { body: null, fieldErrors, formError: "Subí al menos un límite para poder reanudar." };
  }
  return { body, fieldErrors, formError: null };
}

// --- INSUFFICIENT_EVIDENCE ---

export type ManualSource = InsufficientEvidenceResumeBody["manualSources"][number];
export type ManualSourceField = keyof ManualSource;
export type ManualSourceDraft = Record<ManualSourceField, string>;

export function emptyManualSource(): ManualSourceDraft {
  return { url: "", title: "", snippet: "" };
}

/**
 * URL válida para una fuente: absoluta y http(s). Más estricto que el
 * `z.string().url()` del backend, que acepta cualquier esquema: una fuente
 * de investigación es una página web.
 */
export function isValidSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

export interface ManualSourcesValidation {
  body: InsufficientEvidenceResumeBody | null;
  /** Un objeto por fila, en el mismo orden; vacío si la fila es válida. */
  rowErrors: Array<Partial<Record<ManualSourceField, string>>>;
  formError: string | null;
}

const REQUIRED_MESSAGE = "Obligatorio.";

/**
 * Fuentes manuales (AC 3.51): una o más filas `{ url, title, snippet }`, los
 * tres obligatorios, con `url` válida. Se mandan sin los espacios de los
 * bordes.
 */
export function validateManualSources(rows: readonly ManualSourceDraft[]): ManualSourcesValidation {
  if (rows.length === 0) {
    return { body: null, rowErrors: [], formError: "Agregá al menos una fuente." };
  }
  const rowErrors = rows.map((row) => {
    const errors: Partial<Record<ManualSourceField, string>> = {};
    const url = row.url.trim();
    if (url === "") errors.url = REQUIRED_MESSAGE;
    else if (!isValidSourceUrl(url)) errors.url = "Tiene que ser una URL válida que empiece con http:// o https://.";
    if (row.title.trim() === "") errors.title = REQUIRED_MESSAGE;
    if (row.snippet.trim() === "") errors.snippet = REQUIRED_MESSAGE;
    return errors;
  });
  if (rowErrors.some((errors) => Object.keys(errors).length > 0)) return { body: null, rowErrors, formError: null };
  return {
    body: {
      manualSources: rows.map((row) => ({ url: row.url.trim(), title: row.title.trim(), snippet: row.snippet.trim() })),
    },
    rowErrors,
    formError: null,
  };
}

// --- VALIDATION_INCONSISTENCY y VOICE_NOT_CONFIGURED ---

/**
 * Agentes afectados por un VALIDATION_INCONSISTENCY (AC 3.51): los
 * debatientes sin ningún argumento aprobado propio, que es lo que hace
 * fallar `pickCrossExaminationTarget` en el backend. El detalle solo trae
 * argumentos OFFICIAL.
 */
export function agentsWithoutOfficialArguments(detail: Pick<EpisodeDetail, "participants" | "debate">): Participant[] {
  const withArguments = new Set<string>();
  for (const round of detail.debate.rounds) for (const argument of round.arguments) withArguments.add(argument.agentId);
  return detail.participants.filter((participant) => !participant.isJudge && !withArguments.has(participant.agentId));
}

/**
 * Agentes a revisar en un VOICE_NOT_CONFIGURED (AC 3.51): mientras la API no
 * diga cuáles no tienen voz (API-18), todos los participantes del episodio.
 */
export function agentsToReviewForVoices(detail: Pick<EpisodeDetail, "participants">): Participant[] {
  return [...detail.participants];
}
