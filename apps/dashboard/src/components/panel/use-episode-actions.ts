"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { api } from "@/lib/api/client";
import { unwrap } from "@/lib/api/errors";
import {
  actionErrorView,
  refetchesAfterError,
  type ActionErrorView,
  type EpisodeActionRequest,
} from "@/lib/episode-actions";
import { queryKeys } from "@/lib/query-keys";

/** Una operación tipada por acción (API-10; api-contract.md §3). */
async function performAction(episodeId: string, request: EpisodeActionRequest): Promise<void> {
  const path = { path: { id: episodeId } };
  switch (request.action) {
    case "approve":
      unwrap(await api.POST("/episodes/{id}/actions/approve", { params: path }));
      return;
    case "reject":
      unwrap(await api.POST("/episodes/{id}/actions/reject", { params: path }));
      return;
    case "edit":
      unwrap(
        await api.POST("/episodes/{id}/actions/edit", {
          params: path,
          body: { argumentId: request.argumentId, content: request.content },
        }),
      );
      return;
    case "regenerate":
      unwrap(
        await api.POST("/episodes/{id}/actions/regenerate", {
          params: path,
          body: { argumentId: request.argumentId },
        }),
      );
      return;
    case "regenerate-verdict":
      unwrap(await api.POST("/episodes/{id}/actions/regenerate-verdict", { params: path, body: {} }));
      return;
    case "resume":
      unwrap(await api.POST("/episodes/{id}/actions/resume", { params: path, body: request.body }));
      return;
    default: {
      const exhaustive: never = request;
      return exhaustive;
    }
  }
}

export interface EpisodeActions {
  /**
   * Dispara una acción. Si ya hay una en curso sobre el episodio, no hace
   * nada (AC 3.49). `onSuccess` corre después del refetch del detalle.
   */
  run: (request: EpisodeActionRequest, options?: { onSuccess?: () => void }) => void;
  /** La acción en curso, o null. Mientras hay una, las demás se deshabilitan (AC 3.49). */
  pending: EpisodeActionRequest | null;
  /**
   * El error de la última acción, si corresponde a `match`, para mostrarlo
   * junto a su control. Los que refrescan el detalle no: van arriba de la
   * pantalla (`screenNotice`).
   */
  errorFor: (match: (request: EpisodeActionRequest) => boolean) => ActionErrorView | null;
  /**
   * Aviso arriba de la pantalla, hasta la próxima acción o hasta que se
   * cierre: el 409 de transición (AC 3.48, AC 3.85) y el 404 (AC 3.50). Tras
   * el refetch, el control que disparó la acción puede haber desaparecido
   * (otro estado, o el argumento ya no está), y con él su lugar para el error.
   */
  screenNotice: string | null;
  /** Descarta el error a la vista (al cerrar el aviso o cambiar un campo del formulario). */
  clearFailure: () => void;
}

/**
 * Acciones de curaduría sobre un episodio (spec 003, secciones 6 y 7). Una
 * sola mutación para todas: nunca corren dos a la vez (AC 3.49). Tras el
 * éxito, y tras un 409 de transición o un 404, se refresca el detalle
 * (D7; AC 3.48, AC 3.50); la vista nunca aplica la respuesta de la acción
 * por su cuenta. Con el detalle nuevo, la vista en vivo decide sola si
 * vuelve a SSE o a polling (AC 3.43, AC 3.53). Un 401 lo maneja el
 * MutationCache global (AC 3.7).
 */
export function useEpisodeActions(episodeId: string): EpisodeActions {
  const queryClient = useQueryClient();
  // Guarda sincrónica: el estado de la mutación recién se ve en el render
  // siguiente, y dos clicks pueden llegar antes.
  const inFlight = useRef(false);

  async function refreshEpisode() {
    // El detalle (activo) se refresca y se espera; la lista queda marcada
    // como vieja para cuando se vuelva a ella.
    await queryClient.invalidateQueries({ queryKey: queryKeys.episodes.all });
  }

  const mutation = useMutation({
    mutationKey: ["episodes", "action", episodeId],
    mutationFn: (request: EpisodeActionRequest) => performAction(episodeId, request),
    // Se espera el refetch: "Regenerando…" y "Juzgando…" siguen hasta que el
    // texto nuevo está en pantalla (AC 3.45, AC 3.82).
    onSuccess: () => refreshEpisode(),
    onError: async (error, request) => {
      if (refetchesAfterError(actionErrorView(request.action, error))) await refreshEpisode();
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  function run(request: EpisodeActionRequest, options?: { onSuccess?: () => void }) {
    if (inFlight.current) return;
    inFlight.current = true;
    mutation.mutate(request, { onSuccess: options?.onSuccess });
  }

  const failure =
    mutation.isError && mutation.variables !== undefined
      ? { request: mutation.variables, view: actionErrorView(mutation.variables.action, mutation.error) }
      : null;

  return {
    run,
    pending: mutation.isPending ? (mutation.variables ?? null) : null,
    errorFor: (match) =>
      failure !== null && !refetchesAfterError(failure.view) && match(failure.request) ? failure.view : null,
    screenNotice: failure !== null && refetchesAfterError(failure.view) ? failure.view.message : null,
    clearFailure: () => {
      if (mutation.isError) mutation.reset();
    },
  };
}
