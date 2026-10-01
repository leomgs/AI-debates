"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import { api } from "@/lib/api/client";
import { unwrap } from "@/lib/api/errors";
import {
  createActionGuard,
  episodeActionMutationOptions,
  episodeActionsState,
  startEpisodeAction,
} from "@/lib/episode-action-mutation";
import {
  actionErrorView,
  leavesStateOnSuccess,
  showsScreenNotice,
  type ActionErrorView,
  type EpisodeActionRequest,
} from "@/lib/episode-actions";

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
   * junto a su control. Los del aviso de pantalla no (`screenNotice`).
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
 * Elementos que sobreviven a cualquier cambio de estado del episodio, para
 * llevar el foco cuando el panel que lo tenía se desmonta (AC 3.77).
 */
export interface ActionFocusTargets {
  /** Tras aprobar, rechazar o reanudar con éxito: el `<h1>` de la cabecera. */
  afterStateChange: RefObject<HTMLElement | null>;
  /** Tras un error del aviso de pantalla (409 de transición, 404): su contenedor. */
  afterScreenNotice: RefObject<HTMLElement | null>;
}

type FocusRequest = { target: keyof ActionFocusTargets; sequence: number };

/**
 * Acciones de curaduría sobre un episodio (spec 003, secciones 6 y 7). Una
 * sola mutación para todas, con la guarda contra dos a la vez (AC 3.49) y el
 * refetch del detalle tras el éxito y los errores que lo piden (D7; ver
 * episodeActionMutationOptions). Con el detalle nuevo, la vista en vivo
 * decide sola si vuelve a SSE o a polling (AC 3.43, AC 3.53).
 *
 * Foco (AC 3.77): mientras la acción corre, lo tiene el encabezado del panel
 * (useConfirmFocus). Si al terminar el episodio salió del estado, ese panel
 * ya no está, así que el foco pasa a `focusTargets`. Se aplica en un efecto,
 * después de que el detalle nuevo se pintó.
 */
export function useEpisodeActions(episodeId: string, focusTargets: ActionFocusTargets): EpisodeActions {
  const queryClient = useQueryClient();
  const [guard] = useState(createActionGuard);
  const mutation = useMutation(episodeActionMutationOptions(queryClient, episodeId, { perform: performAction, guard }));

  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const focusSequence = useRef(0);
  const { afterStateChange, afterScreenNotice } = focusTargets;
  useEffect(() => {
    if (focusRequest === null) return;
    const ref = focusRequest.target === "afterStateChange" ? afterStateChange : afterScreenNotice;
    ref.current?.focus();
  }, [focusRequest, afterStateChange, afterScreenNotice]);

  function requestFocus(target: FocusRequest["target"]) {
    focusSequence.current += 1;
    setFocusRequest({ target, sequence: focusSequence.current });
  }

  function run(request: EpisodeActionRequest, options?: { onSuccess?: () => void }) {
    startEpisodeAction(
      guard,
      (current) =>
        mutation.mutate(current, {
          onSuccess: () => {
            options?.onSuccess?.();
            if (leavesStateOnSuccess(current.action)) requestFocus("afterStateChange");
          },
          onError: (error) => {
            if (showsScreenNotice(actionErrorView(current.action, error))) requestFocus("afterScreenNotice");
          },
        }),
      request,
    );
  }

  const { pending, failure } = episodeActionsState(mutation);
  const noticeView = failure !== null && showsScreenNotice(failure.view) ? failure.view : null;

  return {
    run,
    pending,
    errorFor: (match) => (failure !== null && noticeView === null && match(failure.request) ? failure.view : null),
    screenNotice: noticeView?.message ?? null,
    clearFailure: () => {
      if (mutation.isError) mutation.reset();
    },
  };
}
