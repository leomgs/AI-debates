"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { unwrap } from "@/lib/api/errors";
import {
  STATUS_FILTER_PARAM,
  emptyGroupMessage,
  groupEpisodes,
  listRefetchInterval,
  parseStatusFilter,
  serializeStatusFilter,
  studioListHref,
  type EpisodeListItem,
} from "@/lib/episode-list";
import { EPISODE_STATUS_UI, STUDIO_GROUP_LABELS, type EpisodeStatus, type StudioGroup } from "@/lib/episode-status";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { EpisodeRow } from "./episode-row";
import { ErrorNotice } from "./error-notice";
import { StatusFilter } from "./status-filter";

async function fetchEpisodes(statusCsv: string | null): Promise<EpisodeListItem[]> {
  return unwrap(await api.GET("/episodes", { params: { query: statusCsv ? { status: statusCsv } : {} } }));
}

// Lista /studio (spec 003, sección 3). El filtro vive en la URL (AC 3.19):
// se lee con useSearchParams, así que se puede compartir y recargar.
export function EpisodeList() {
  const searchParams = useSearchParams();
  const statuses = parseStatusFilter(searchParams.getAll(STATUS_FILTER_PARAM));
  const statusCsv = serializeStatusFilter(statuses);

  const query = useQuery({
    queryKey: queryKeys.episodes.list(statusCsv),
    queryFn: () => fetchEpisodes(statusCsv),
    // AC 3.21: se refresca sola (10 s, D19) mientras haya algo "En curso".
    refetchInterval: (current) => listRefetchInterval(current.state.data),
    // Al cambiar el filtro, la lista anterior queda a la vista (con un
    // indicador) hasta que llega la nueva, en vez de volver al skeleton.
    placeholderData: keepPreviousData,
  });

  // History API nativa y no router.replace: el router navega en una
  // transición (con el layout force-dynamic, un round-trip al servidor) y
  // useSearchParams devuelve el valor viejo hasta que termina, así que dos
  // clicks rápidos pisaban la selección anterior. replaceState se sincroniza
  // con useSearchParams en el momento y no pide nada al servidor (guía de
  // Next 16.3.6, "Linking and Navigating", "Native History API").
  function setFilter(next: EpisodeStatus[]) {
    window.history.replaceState(null, "", studioListHref(searchParams.toString(), next));
  }

  const updating = query.isPlaceholderData;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Episodios</h1>
        <div className="flex items-center gap-2">
          <StatusFilter selected={statuses} onChange={setFilter} />
          <Button asChild size="sm">
            <Link href="/studio/new">Crear episodio</Link>
          </Button>
        </div>
      </div>

      <div className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {statuses.length > 0 && (
          <p className="flex flex-wrap items-center gap-2">
            Filtrando por: {statuses.map((status) => EPISODE_STATUS_UI[status].label).join(", ")}
            <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setFilter([])}>
              Quitar filtro
            </Button>
          </p>
        )}
        <p role="status" className="flex items-center gap-1.5">
          {updating && (
            <>
              <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
              Actualizando la lista…
            </>
          )}
        </p>
      </div>

      <div aria-busy={updating} className={cn("transition-opacity", updating && "opacity-60")}>
        <EpisodeListBody
          episodes={query.data}
          isPending={query.isPending}
          error={query.isError ? query.error : null}
          isFetching={query.isFetching}
          onRetry={() => query.refetch()}
          statusFilter={statuses}
          onClearFilter={() => setFilter([])}
        />
      </div>
    </section>
  );
}

function EpisodeListBody({
  episodes,
  isPending,
  error,
  isFetching,
  onRetry,
  statusFilter,
  onClearFilter,
}: {
  episodes: EpisodeListItem[] | undefined;
  isPending: boolean;
  error: unknown;
  isFetching: boolean;
  onRetry: () => void;
  statusFilter: readonly EpisodeStatus[];
  onClearFilter: () => void;
}) {
  // AC 3.20: mientras carga, un placeholder de la lista.
  if (isPending) return <EpisodeListSkeleton />;

  // AC 3.20: si falla, error genérico con reintentar. Si ya había datos (falló
  // un refresco), se siguen mostrando con el aviso arriba.
  if (!episodes) {
    return <ErrorNotice title="No se pudo cargar la lista de episodios" error={error} onRetry={onRetry} retrying={isFetching} />;
  }

  const refreshError = error ? (
    <ErrorNotice title="No se pudo actualizar la lista" error={error} onRetry={onRetry} retrying={isFetching} />
  ) : null;

  if (episodes.length === 0) {
    return (
      <>
        {refreshError}
        {statusFilter.length > 0 ? (
          <div className="rounded-md border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            <p>Ningún episodio coincide con el filtro.</p>
            <Button variant="link" onClick={onClearFilter}>
              Quitar filtro
            </Button>
          </div>
        ) : (
          // AC 3.20: sin episodios, acceso directo a "Crear episodio".
          <div className="space-y-4 rounded-md border border-dashed px-6 py-10 text-center">
            <p className="text-muted-foreground">Todavía no hay episodios.</p>
            <Button asChild>
              <Link href="/studio/new">Crear episodio</Link>
            </Button>
          </div>
        )}
      </>
    );
  }

  const groups = groupEpisodes(episodes);
  return (
    <div className="space-y-8">
      {refreshError}
      <EpisodeGroup
        group="requires-action"
        episodes={groups["requires-action"]}
        emptyMessage={emptyGroupMessage("requires-action", statusFilter)}
      />
      {groups["in-progress"].length > 0 && <EpisodeGroup group="in-progress" episodes={groups["in-progress"]} />}
      {groups.finished.length > 0 && <EpisodeGroup group="finished" episodes={groups.finished} />}
    </div>
  );
}

// "Requiere acción" se destaca, lleva contador y nunca se oculta: vacía dice
// "Nada pendiente", salvo que el filtro excluya sus estados (AC 3.18). Los
// otros grupos solo se muestran con episodios.
function EpisodeGroup({
  group,
  episodes,
  emptyMessage,
}: {
  group: StudioGroup;
  episodes: EpisodeListItem[];
  emptyMessage?: string;
}) {
  const headingId = `episodes-group-${group}`;
  const highlighted = group === "requires-action";
  return (
    <section
      aria-labelledby={headingId}
      className={cn("space-y-2", highlighted && "rounded-lg border border-primary/40 bg-card p-4")}
    >
      <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        <span className={cn(highlighted && "text-foreground")}>{STUDIO_GROUP_LABELS[group]}</span>
        <span
          className={cn(
            "rounded-full px-2 text-xs normal-case",
            highlighted && episodes.length > 0 ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground",
          )}
        >
          {episodes.length}
        </span>
      </h2>
      {episodes.length === 0 ? (
        <p className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <ul className="divide-y">
          {episodes.map((episode) => (
            <li key={episode.id}>
              <EpisodeRow episode={episode} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function EpisodeListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Cargando episodios">
      <Skeleton className="h-6 w-40" />
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-14" />
      ))}
    </div>
  );
}
