// Intervalos de polling del panel (spec 003, D19; AC 3.86). Es el único
// lugar donde se definen: ninguna pantalla declara su propio intervalo, así
// que cambiar uno no requiere tocar ninguna pantalla.
export const POLLING_INTERVALS_MS = {
  /** Contador y lista del inbox de notificaciones (AC 3.10). */
  inbox: 30_000,
  /** Detalle de un episodio en las fases sin SSE (AC 3.35). */
  episodeDetail: 10_000,
  /** Lista /studio mientras haya episodios "En curso" (AC 3.21). */
  episodeList: 10_000,
} as const;
