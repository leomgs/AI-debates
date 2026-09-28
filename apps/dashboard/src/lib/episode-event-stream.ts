import { API_BASE_URL } from "@/lib/api/client";
import type { paths } from "@/lib/api/schema";
import { BUSINESS_EVENT_TYPES, parseBusinessEvent, type BusinessEvent, type BusinessEventType } from "@/lib/episode-events";
import { reconnectDelayMs } from "@/lib/live-updates";

// Cliente SSE de la vista en vivo (spec 003, AC 3.32-3.38; Restricciones
// técnicas, "Cliente SSE"). Sin React y con el EventSource y los timers
// inyectables, para testear la reconexión sin navegador.

const EVENTS_PATH = "/episodes/{id}/events" satisfies keyof paths;

/** URL del stream, por el mismo origen (/api, rewrite hacia la API; AC 3.9). */
export function episodeEventsUrl(episodeId: string): string {
  return `${API_BASE_URL}${EVENTS_PATH.replace("{id}", encodeURIComponent(episodeId))}`;
}

/**
 * - `connecting`: EventSource creado, sin respuesta todavía. Nest manda las
 *   cabeceras recién con el primer mensaje, así que puede durar hasta el
 *   primer `heartbeat` (~15 s; decision-log del dashboard, entrada 7).
 * - `live`: conexión abierta o eventos llegando.
 * - `disconnected`: se cortó; se está refrescando el detalle para decidir si
 *   reconectar (AC 3.38).
 * - `closed`: se decidió no reconectar (el estado ya no es "SSE" o el
 *   pipeline no está activo).
 */
export type StreamConnectionState = "connecting" | "live" | "disconnected" | "closed";

/** Lo que el cliente usa de EventSource. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
  close(): void;
}

interface Timers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const GLOBAL_TIMERS: Timers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export interface EpisodeEventStreamOptions {
  url: string;
  createEventSource: (url: string) => EventSourceLike;
  /**
   * Cada evento de negocio: `event` es null si el payload no se pudo leer.
   * En los dos casos corresponde refrescar el detalle (D7; AC 3.34).
   */
  onEvent: (event: BusinessEvent | null, type: BusinessEventType) => void;
  onStateChange: (state: StreamConnectionState) => void;
  /**
   * Tras un corte: refresca el detalle y resuelve si hay que reconectar
   * (estado "SSE" con `pipelineActive`; AC 3.38). Un 401 en el SSE no se
   * puede leer desde EventSource: lo detecta este refresco (AC 3.7).
   */
  refetchAndDecide: () => Promise<boolean>;
  timers?: Timers;
}

export class EpisodeEventStream {
  private readonly options: EpisodeEventStreamOptions;
  private readonly timers: Timers;
  private source: EventSourceLike | null = null;
  private reconnectTimer: unknown = null;
  private stopped = true;
  /**
   * Sube con cada start() y stop(). Un refresco (recover) o un timer que
   * empezó en una generación anterior no hace nada al terminar: sin esto,
   * un stop() seguido de start() mientras se refrescaba dejaba dos
   * conexiones (la nueva y la reconexión de la vieja).
   */
  private generation = 0;
  /** Reconexiones seguidas sin que la conexión llegue a abrirse. */
  private attempt = 0;
  private state: StreamConnectionState | null = null;

  constructor(options: EpisodeEventStreamOptions) {
    this.options = options;
    this.timers = options.timers ?? GLOBAL_TIMERS;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.generation += 1;
    this.attempt = 0;
    this.connect();
  }

  /** Cierra la conexión (y con ella la de la API) y cancela una reconexión pendiente. */
  stop(): void {
    this.stopped = true;
    this.generation += 1;
    if (this.reconnectTimer !== null) {
      this.timers.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.source?.close();
    this.source = null;
  }

  private setState(state: StreamConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.options.onStateChange(state);
  }

  private connect(): void {
    this.setState("connecting");
    const source = this.options.createEventSource(this.options.url);
    this.source = source;
    // Un listener de una conexión ya cerrada (o del cliente detenido) no hace nada.
    const isCurrent = () => !this.stopped && this.source === source;

    source.addEventListener("open", () => {
      if (!isCurrent()) return;
      this.attempt = 0;
      this.setState("live");
    });

    for (const type of BUSINESS_EVENT_TYPES) {
      source.addEventListener(type, (message) => {
        if (!isCurrent()) return;
        this.attempt = 0;
        this.setState("live");
        this.options.onEvent(parseBusinessEvent(type, typeof message.data === "string" ? message.data : ""), type);
      });
    }

    // Corte, fin del stream (el backend lo completa al terminar la corrida)
    // o respuesta sin stream (204 sin pipeline activo, 401, 404). Se cierra
    // siempre: la reconexión automática de EventSource entraría en loop
    // contra un episodio frenado (spec 003, edge case "El stream se cierra
    // solo").
    source.addEventListener("error", () => {
      if (!isCurrent()) return;
      source.close();
      this.source = null;
      this.setState("disconnected");
      void this.recover();
    });
  }

  private async recover(): Promise<void> {
    const generation = this.generation;
    const isCurrentGeneration = () => !this.stopped && this.generation === generation;
    let reconnect: boolean;
    try {
      reconnect = await this.options.refetchAndDecide();
    } catch {
      // No debería pasar (el refresco no lanza); ante la duda, se reintenta
      // con la espera creciente, que vuelve a refrescar si falla.
      reconnect = true;
    }
    if (!isCurrentGeneration()) return;
    if (!reconnect) {
      this.setState("closed");
      return;
    }
    const delay = reconnectDelayMs(this.attempt);
    this.attempt += 1;
    this.reconnectTimer = this.timers.setTimeout(() => {
      this.reconnectTimer = null;
      if (isCurrentGeneration()) this.connect();
    }, delay);
  }
}
