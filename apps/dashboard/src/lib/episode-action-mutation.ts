import type { MutationObserverResult, MutationOptions, QueryClient } from "@tanstack/react-query";
import {
  actionErrorView,
  refetchesAfterError,
  type ActionErrorView,
  type EpisodeActionRequest,
} from "@/lib/episode-actions";
import { queryKeys } from "@/lib/query-keys";

// La mutación única de las acciones del detalle (spec 003, secciones 6 y 7),
// sin React: el hook useEpisodeActions solo la conecta con useMutation y el
// foco. Así se testea con un QueryClient real y un MutationObserver.

/** La llamada HTTP de una acción (una operación tipada por acción, API-10). */
export type PerformEpisodeAction = (episodeId: string, request: EpisodeActionRequest) => Promise<void>;

/**
 * Guarda sincrónica contra dos acciones a la vez (AC 3.49): el estado de la
 * mutación recién se ve en el render siguiente, y dos clicks pueden llegar
 * antes.
 */
export interface ActionGuard {
  /** true si no había otra acción en curso; desde ahí, la guarda queda tomada. */
  tryAcquire: () => boolean;
  release: () => void;
}

export function createActionGuard(): ActionGuard {
  let busy = false;
  return {
    tryAcquire() {
      if (busy) return false;
      busy = true;
      return true;
    },
    release() {
      busy = false;
    },
  };
}

/**
 * Opciones de la mutación de un episodio:
 * - Tras el éxito, y tras los errores con `refetch` (409 de transición, 404
 *   y presupuesto LLM agotado), se refresca el detalle y se espera: la
 *   mutación sigue pendiente ("Regenerando…", "Juzgando…") hasta que lo
 *   nuevo está en pantalla, y el error se muestra con el detalle ya al día
 *   (D7; AC 3.45, AC 3.48, AC 3.50, AC 3.82). La vista nunca aplica la
 *   respuesta de la acción por su cuenta.
 * - `networkMode: "always"`: sin red, la mutación falla enseguida con "No
 *   hubo respuesta del servidor…" en vez de quedar en pausa con el botón en
 *   "Juzgando…".
 * - La guarda se libera al terminar, con éxito o con error.
 * Un 401 lo maneja el MutationCache global (AC 3.7).
 */
export function episodeActionMutationOptions(
  queryClient: QueryClient,
  episodeId: string,
  deps: { perform: PerformEpisodeAction; guard: ActionGuard },
): MutationOptions<void, Error, EpisodeActionRequest> {
  async function refreshEpisode() {
    // El detalle (activo) se refresca y se espera; la lista queda marcada
    // como vieja para cuando se vuelva a ella.
    await queryClient.invalidateQueries({ queryKey: queryKeys.episodes.all });
  }

  return {
    mutationKey: ["episodes", "action", episodeId],
    mutationFn: (request) => deps.perform(episodeId, request),
    networkMode: "always",
    onSuccess: () => refreshEpisode(),
    onError: async (error, request) => {
      if (refetchesAfterError(actionErrorView(request.action, error))) await refreshEpisode();
    },
    onSettled: () => {
      deps.guard.release();
    },
  };
}

/**
 * Dispara una acción si no hay otra en curso (AC 3.49); si la hay, no hace
 * nada y devuelve false.
 */
export function startEpisodeAction(
  guard: ActionGuard,
  mutate: (request: EpisodeActionRequest) => void,
  request: EpisodeActionRequest,
): boolean {
  if (!guard.tryAcquire()) return false;
  mutate(request);
  return true;
}

export interface EpisodeActionsState {
  /** La acción en curso, o null: con cualquier error vuelve a null. */
  pending: EpisodeActionRequest | null;
  /** El error de la última acción, con la acción que lo produjo. */
  failure: { request: EpisodeActionRequest; view: ActionErrorView } | null;
}

/** Lo que muestra la pantalla a partir del resultado de la mutación. */
export function episodeActionsState(
  result: Pick<MutationObserverResult<void, Error, EpisodeActionRequest>, "status" | "variables" | "error">,
): EpisodeActionsState {
  const request = result.variables;
  return {
    pending: result.status === "pending" ? (request ?? null) : null,
    failure:
      result.status === "error" && request !== undefined
        ? { request, view: actionErrorView(request.action, result.error) }
        : null,
  };
}
