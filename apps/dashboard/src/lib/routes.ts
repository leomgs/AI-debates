// Rutas del panel que se arman con datos (spec 003, "Mapa de rutas").

/** Detalle de un episodio: destino de la lista, del inbox y de "Crear" (AC 3.12, 3.17, 3.24). */
export function episodeHref(episodeId: string): string {
  return `/studio/episodes/${encodeURIComponent(episodeId)}`;
}
