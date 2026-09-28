// Claves de TanStack Query del panel, en un solo lugar para que las
// invalidaciones (tras crear un episodio o marcar notificaciones) apunten a
// las mismas consultas que las pantallas.
export const queryKeys = {
  notifications: {
    all: ["notifications"] as const,
    unread: ["notifications", "unread"] as const,
    history: ["notifications", "history"] as const,
  },
  episodes: {
    all: ["episodes"] as const,
    /** `statusCsv` es el filtro ya normalizado (serializeStatusFilter), o null. */
    list: (statusCsv: string | null) => ["episodes", "list", statusCsv] as const,
    /** Detalle de un episodio: lo invalidan los eventos SSE (D7) y lo refresca el polling (D19). */
    detail: (episodeId: string) => ["episodes", "detail", episodeId] as const,
  },
} as const;
