import type { components } from "@/lib/api/schema";
import { EPISODE_STATUSES, EPISODE_STATUS_UI, isEpisodeStatus, type EpisodeStatus, type StudioGroup } from "@/lib/episode-status";
import { POLLING_INTERVALS_MS } from "@/lib/polling";

// Lógica de la lista /studio (spec 003, sección 3), sin React, para poder
// testearla sin DOM.

export type EpisodeListItem = components["schemas"]["EpisodeListItemDto_Output"];

export type GroupedEpisodes = Readonly<Record<StudioGroup, EpisodeListItem[]>>;

/** Nombre del parámetro de la URL con el filtro de estados (AC 3.19). */
export const STATUS_FILTER_PARAM = "status";

// Más nuevo primero. createdAt es ISO 8601 en UTC (siempre con "Z"), así que
// el orden de los strings coincide con el cronológico, pero se compara por
// fecha para no depender del formato.
function byCreatedAtDesc(a: EpisodeListItem, b: EpisodeListItem): number {
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

/**
 * Agrupa en Requiere acción / En curso / Terminados según la columna "Grupo"
 * del mapeo de estados, y ordena cada grupo de más nuevo a más viejo
 * (AC 3.16). No depende del orden en que responda la API.
 */
export function groupEpisodes(episodes: readonly EpisodeListItem[]): GroupedEpisodes {
  const groups: Record<StudioGroup, EpisodeListItem[]> = { "requires-action": [], "in-progress": [], finished: [] };
  for (const episode of episodes) groups[EPISODE_STATUS_UI[episode.status].group].push(episode);
  for (const list of Object.values(groups)) list.sort(byCreatedAtDesc);
  return groups;
}

/** La lista se refresca sola mientras haya algún episodio "En curso" (AC 3.21). */
export function listRefetchInterval(episodes: readonly EpisodeListItem[] | undefined): number | false {
  const anyInProgress = episodes?.some((episode) => EPISODE_STATUS_UI[episode.status].group === "in-progress") ?? false;
  return anyInProgress ? POLLING_INTERVALS_MS.episodeList : false;
}

/**
 * Lee el filtro desde la URL (`?status=PENDING_REVIEW,FAILED`, el mismo CSV
 * que acepta `listEpisodes`). Tolerante (AC 3.19): ignora valores inválidos,
 * vacíos y repetidos, acepta minúsculas y espacios, y también el parámetro
 * repetido (`?status=A&status=B`). Devuelve los estados en el orden de la
 * tabla de la spec, para que el mismo filtro dé siempre la misma clave de
 * caché y la misma URL.
 */
export function parseStatusFilter(values: readonly string[]): EpisodeStatus[] {
  const requested = new Set(
    values
      .flatMap((value) => value.split(","))
      .map((value) => value.trim().toUpperCase())
      .filter(isEpisodeStatus),
  );
  return EPISODE_STATUSES.filter((status) => requested.has(status));
}

/** CSV para la URL y para `listEpisodes`; `null` si no hay filtro. */
export function serializeStatusFilter(statuses: readonly EpisodeStatus[]): string | null {
  const ordered = EPISODE_STATUSES.filter((status) => statuses.includes(status));
  return ordered.length > 0 ? ordered.join(",") : null;
}

/** Path de /studio con el filtro dado, conservando el resto de la query. */
export function studioListHref(currentQuery: string, statuses: readonly EpisodeStatus[]): string {
  const params = new URLSearchParams(currentQuery);
  const csv = serializeStatusFilter(statuses);
  if (csv === null) params.delete(STATUS_FILTER_PARAM);
  else params.set(STATUS_FILTER_PARAM, csv);
  // URLSearchParams codifica la coma como %2C; se deja legible, porque la
  // coma es válida en una query (RFC 3986) y la URL se comparte (AC 3.19).
  const query = params.toString().replace(/%2C/gi, ",");
  return query ? `/studio?${query}` : "/studio";
}
