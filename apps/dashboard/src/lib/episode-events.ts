import type { operations } from "@/lib/api/schema";
import { checkpointReasonLabel } from "@/lib/checkpoint-reasons";
import { agentName, excerpt, type Participant } from "@/lib/episode-detail";

// Eventos SSE de un episodio (Feature 8; spec 003, AC 3.32-3.34) y su
// traducción al feed de actividad, sin React. Los tipos salen de los DTOs
// de evento de openapi.json (D5).

type StreamEvent = operations["streamEpisodeEvents"]["responses"][200]["content"]["text/event-stream"];

/**
 * Eventos de negocio: todos menos `heartbeat` (API-13), que solo mantiene
 * viva la conexión y nunca llega al feed (AC 3.33). La API lo manda sin
 * línea `data:`, así que EventSource ni siquiera lo despacha.
 */
export type BusinessEvent = Exclude<StreamEvent, { type: "heartbeat" }>;
export type BusinessEventType = BusinessEvent["type"];

// Record: un tipo de evento nuevo en openapi.json hace fallar el build hasta
// que el cliente lo escuche.
const BUSINESS_EVENT_TYPE_SET: Readonly<Record<BusinessEventType, true>> = {
  "research.started": true,
  "agent.thinking": true,
  "fact_check.completed": true,
  "argument.approved": true,
  "episode.pending_review": true,
  "episode.requires_review": true,
};

/**
 * Los tipos que escucha el cliente, uno por uno con addEventListener: los
 * eventos tienen nombre (`event:`), así que `onmessage` no recibe ninguno
 * (Restricciones técnicas, "Cliente SSE").
 */
export const BUSINESS_EVENT_TYPES = Object.keys(BUSINESS_EVENT_TYPE_SET) as BusinessEventType[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Chequeo mínimo del payload, para que un evento mal formado no rompa el
// feed. El refetch del detalle (D7) se hace igual, con o sin payload válido.
const HAS_EXPECTED_DATA: Readonly<Record<BusinessEventType, (data: Record<string, unknown>) => boolean>> = {
  "research.started": () => true,
  "agent.thinking": (data) => typeof data.agentId === "string" && typeof data.round === "number",
  "fact_check.completed": (data) =>
    (data.status === "PASSED" || data.status === "FAILED") && typeof data.errorsDetected === "number",
  "argument.approved": (data) => typeof data.agentId === "string" && typeof data.text === "string",
  "episode.pending_review": () => true,
  "episode.requires_review": (data) => typeof data.reason === "string",
};

/**
 * Arma el evento a partir del nombre (`event:`) y la línea `data:` (el JSON
 * del `data` del DTO; Nest serializa solo ese campo). null si el payload no
 * es JSON o no tiene la forma esperada.
 */
export function parseBusinessEvent(type: BusinessEventType, rawData: string): BusinessEvent | null {
  let data: unknown;
  try {
    data = JSON.parse(rawData);
  } catch {
    return null;
  }
  if (!isRecord(data) || !HAS_EXPECTED_DATA[type](data)) return null;
  return { type, data } as BusinessEvent;
}

export interface FeedLine {
  /** Texto de la interfaz, en español. */
  text: string;
  /** Extracto del contenido del debate, en el idioma del episodio (AC 3.79 b). */
  quote?: string;
}

function pluralErrors(count: number): string {
  return count === 1 ? "1 error detectado" : `${count} errores detectados`;
}

/**
 * Línea legible de cada evento (AC 3.32). El nombre del agente sale de los
 * participantes del detalle (API-1): el payload solo trae su `agentId`.
 */
export function feedLine(event: BusinessEvent, participants: readonly Participant[]): FeedLine {
  switch (event.type) {
    case "research.started":
      return { text: "Empezó la investigación" };
    case "agent.thinking":
      return {
        text: `${agentName(participants, event.data.agentId)} está preparando su argumento de la ronda ${event.data.round}`,
      };
    case "fact_check.completed":
      return {
        text: event.data.status === "PASSED" ? "Fact-check: aprobado" : `Fact-check: ${pluralErrors(event.data.errorsDetected)}`,
      };
    case "argument.approved":
      return { text: `Nuevo argumento de ${agentName(participants, event.data.agentId)}`, quote: excerpt(event.data.text) };
    case "episode.pending_review":
      return { text: "El debate terminó y espera tu revisión" };
    case "episode.requires_review":
      return { text: `El episodio requiere intervención: ${checkpointReasonLabel(event.data.reason)}` };
  }
}

export interface FeedEntry {
  /** Correlativo local, para la `key` de React. */
  id: number;
  /** Cuándo llegó el evento al navegador (ISO): el SSE no trae fecha. */
  receivedAt: string;
  event: BusinessEvent;
}

/** Tope del feed: es informativo (D7) y no tiene que crecer sin fin con la pantalla abierta. */
export const MAX_FEED_ENTRIES = 200;

/** Agrega una entrada al principio (más nueva primero) y descarta las más viejas. */
export function prependFeedEntry(feed: readonly FeedEntry[], entry: FeedEntry, max: number = MAX_FEED_ENTRIES): FeedEntry[] {
  return [entry, ...feed].slice(0, max);
}
