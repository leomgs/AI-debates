import { ApiError, isUnauthorizedError } from "@/lib/api/errors";
import type { EpisodeDetail } from "@/lib/episode-detail";
import { episodeStatusUi, type EpisodeStatus } from "@/lib/episode-status";
import { POLLING_INTERVALS_MS } from "@/lib/polling";

// Cómo se entera el detalle de un cambio (spec 003, "Mapeo de estados a UI",
// AC 3.32-3.39), sin React, para poder testearlo sin DOM.

/**
 * - `sse`: suscripto a streamEpisodeEvents, con refetch por evento (D7).
 * - `polling`: refetch del detalle cada 10 s (D19; AC 3.35).
 * - `stuck`: estado activo con `pipelineActive` en false; sin SSE ni polling
 *   (AC 3.39).
 * - `none`: pipeline frenado o terminado; la pantalla no se actualiza sola
 *   (AC 3.36).
 */
export type LiveUpdateMode = "sse" | "polling" | "stuck" | "none";

/**
 * SSE y polling solo corren si además `pipelineActive` es true (API-12). Un
 * estado activo (con "SSE" o "Polling" en el mapeo) sin pipeline activo es
 * un episodio trabado.
 */
export function liveUpdateMode(status: EpisodeStatus, pipelineActive: boolean): LiveUpdateMode {
  const { updates } = episodeStatusUi(status);
  if (updates === "none") return "none";
  if (!pipelineActive) return "stuck";
  return updates;
}

export function detailLiveUpdateMode(detail: Pick<EpisodeDetail, "status" | "pipelineActive">): LiveUpdateMode {
  return liveUpdateMode(detail.status, detail.pipelineActive);
}

/**
 * `refetchInterval` de la consulta del detalle: 10 s solo en modo polling
 * (AC 3.35). Se deja de refrescar al llegar a un estado sin actualización o
 * si el episodio queda trabado (AC 3.39).
 */
export function detailRefetchInterval(detail: EpisodeDetail | undefined): number | false {
  return detail !== undefined && detailLiveUpdateMode(detail) === "polling" ? POLLING_INTERVALS_MS.episodeDetail : false;
}

/**
 * Tras perder la conexión SSE y refrescar el detalle (AC 3.38): se reconecta
 * solo si el estado sigue siendo "SSE" con `pipelineActive` en true. Con un
 * 401 no (el manejo global lleva a /login, AC 3.7), ni con un 404 (el
 * episodio ya no existe). Si el refresco falló por otra causa (red, 5xx), se
 * decide con el último detalle conocido: el reintento de la conexión vuelve
 * a refrescarlo.
 */
export function shouldReconnectAfterRefetch(params: {
  detail: EpisodeDetail | undefined;
  error: unknown;
}): boolean {
  const { detail, error } = params;
  if (isUnauthorizedError(error)) return false;
  if (error instanceof ApiError && error.status === 404) return false;
  return detail !== undefined && detailLiveUpdateMode(detail) === "sse";
}

const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

/**
 * Espera antes de reconectar: 1 s, 2 s, 4 s… hasta 30 s. Evita un loop
 * contra el backend si el stream se corta enseguida una y otra vez (por
 * ejemplo, un 204 mientras el detalle todavía dice pipeline activo). El
 * contador vuelve a 0 con cada conexión abierta.
 */
export function reconnectDelayMs(attempt: number): number {
  return Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** Math.max(0, attempt));
}
