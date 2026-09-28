"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { API_ERROR_CODES } from "@/lib/api/error-codes";
import { ApiError, unwrap } from "@/lib/api/errors";
import type { EpisodeDetail } from "@/lib/episode-detail";
import { prependFeedEntry, type BusinessEvent, type FeedEntry } from "@/lib/episode-events";
import { detailLiveUpdateMode, detailRefetchInterval } from "@/lib/live-updates";
import { queryKeys } from "@/lib/query-keys";
import { CheckpointHistory } from "./checkpoint-history";
import { DebateTimeline } from "./debate-timeline";
import { EpisodeHeader } from "./episode-header";
import { EpisodeStatusNotice } from "./episode-status-notice";
import { ErrorNotice } from "./error-notice";
import { LiveActivity } from "./live-activity";
import { UsagePanel } from "./usage-panel";
import { useEpisodeEventStream } from "./use-episode-event-stream";
import { VerdictSection } from "./verdict-section";

async function fetchEpisodeDetail(episodeId: string): Promise<EpisodeDetail> {
  return unwrap(await api.GET("/episodes/{id}", { params: { path: { id: episodeId } } }));
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === API_ERROR_CODES.NOT_FOUND;
}

/**
 * Detalle de un episodio y vista en vivo (spec 003, sección 5). El detalle
 * (getEpisodeDetail) es la única fuente de verdad (D7): el SSE solo dispara
 * refrescos y alimenta el feed, y en las fases sin SSE se refresca por
 * polling (D19). Los datos se piden desde el navegador (D11).
 */
export function EpisodeDetailView({ episodeId }: { episodeId: string }) {
  const query = useQuery({
    queryKey: queryKeys.episodes.detail(episodeId),
    queryFn: () => fetchEpisodeDetail(episodeId),
    // AC 3.35: 10 s solo en APPROVED/GENERATING_AUDIO/RENDERING con
    // pipeline activo; se apaga solo al llegar a un estado sin actualización.
    refetchInterval: (current) => detailRefetchInterval(current.state.data),
  });

  const detail = query.data;
  const mode = detail ? detailLiveUpdateMode(detail) : "none";

  // Feed informativo: arranca vacío al abrir la pantalla (AC 3.37).
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const nextFeedId = useRef(0);
  function addToFeed(event: BusinessEvent) {
    const entry: FeedEntry = { id: nextFeedId.current++, receivedAt: new Date().toISOString(), event };
    setFeed((current) => prependFeedEntry(current, entry));
  }

  // AC 3.32: suscripto solo en estados "SSE" con pipelineActive.
  const connection = useEpisodeEventStream({ episodeId, enabled: mode === "sse", onEvent: addToFeed });

  // AC 3.73: carga, error y (AC 3.41) no encontrado.
  if (query.isPending) return <EpisodeDetailSkeleton />;
  if (!detail) {
    if (isNotFound(query.error)) return <EpisodeNotFound />;
    return (
      <ErrorNotice
        title="No se pudo cargar el episodio"
        error={query.error}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  // Un refresco que falla deja los últimos datos a la vista, con el aviso.
  const refreshError = query.isError ? (
    <ErrorNotice
      title="No se pudo actualizar el episodio"
      error={query.error}
      onRetry={() => query.refetch()}
      retrying={query.isFetching}
    />
  ) : null;

  // AC 3.39: trabado, sin feed. Fuera de las fases con SSE, el feed que se
  // haya acumulado queda a la vista, como transmisión finalizada.
  const showLiveActivity = mode === "sse" || (mode !== "stuck" && feed.length > 0);

  return (
    <article className="space-y-6">
      <EpisodeHeader detail={detail} />
      {refreshError}
      <EpisodeStatusNotice
        detail={detail}
        mode={mode}
        onRefresh={() => query.refetch()}
        refreshing={query.isFetching}
      />
      {showLiveActivity && (
        <LiveActivity
          feed={feed}
          connection={connection}
          active={mode === "sse"}
          participants={detail.participants}
          language={detail.language}
        />
      )}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-8">
          <DebateTimeline detail={detail} />
          <VerdictSection detail={detail} />
        </div>
        <aside aria-label="Presupuesto e interrupciones" className="space-y-8">
          <UsagePanel usage={detail.usage} limits={detail.limits} />
          <CheckpointHistory checkpoints={detail.checkpoints} rounds={detail.debate.rounds} />
        </aside>
      </div>
    </article>
  );
}

function EpisodeNotFound() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Episodio no encontrado</h1>
      <p className="text-muted-foreground">El episodio que buscás no existe.</p>
      <Link href="/studio" className="text-sm underline underline-offset-4">
        Volver a la lista de episodios
      </Link>
    </section>
  );
}

export function EpisodeDetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Cargando el episodio">
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-3">
          <Skeleton className="h-6 w-32" />
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-24" />
        </div>
      </div>
    </div>
  );
}
