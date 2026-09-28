"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState } from "react";
import type { EpisodeDetail } from "@/lib/episode-detail";
import { EpisodeEventStream, episodeEventsUrl, type StreamConnectionState } from "@/lib/episode-event-stream";
import type { BusinessEvent } from "@/lib/episode-events";
import { shouldReconnectAfterRefetch } from "@/lib/live-updates";
import { queryKeys } from "@/lib/query-keys";

/**
 * Suscripción SSE de un episodio (AC 3.32-3.38). Solo corre con `enabled`
 * (estado "SSE" con `pipelineActive`); al pasar a false (estado frenado o
 * terminal, AC 3.36; trabado, AC 3.39) o al desmontar, cierra la conexión.
 * Cada evento de negocio refresca el detalle (D7; AC 3.34) y se entrega a
 * `onEvent` para el feed.
 */
export function useEpisodeEventStream({
  episodeId,
  enabled,
  onEvent,
}: {
  episodeId: string;
  enabled: boolean;
  onEvent: (event: BusinessEvent) => void;
}): StreamConnectionState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamConnectionState>("connecting");
  const handleEvent = useEffectEvent(onEvent);

  useEffect(() => {
    if (!enabled) return;
    const queryKey = queryKeys.episodes.detail(episodeId);
    const stream = new EpisodeEventStream({
      url: episodeEventsUrl(episodeId),
      // Mismo origen: la cookie de sesión viaja sola (sin withCredentials).
      createEventSource: (url) => new EventSource(url),
      onEvent: (event) => {
        // D7: la UI no reconstruye estado con el payload; refresca el detalle.
        void queryClient.invalidateQueries({ queryKey, exact: true });
        if (event !== null) handleEvent(event);
      },
      onStateChange: setState,
      // AC 3.38: tras un corte, refresco y decisión con el detalle nuevo. Un
      // 401 en ese refresco lo maneja el QueryCache global (AC 3.7).
      refetchAndDecide: async () => {
        await queryClient.refetchQueries({ queryKey, exact: true });
        const query = queryClient.getQueryState<EpisodeDetail>(queryKey);
        return shouldReconnectAfterRefetch({
          detail: query?.data,
          error: query?.status === "error" ? query.error : null,
        });
      },
    });
    stream.start();
    return () => stream.stop();
  }, [enabled, episodeId, queryClient]);

  return state;
}
