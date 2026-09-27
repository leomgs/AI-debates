import type { components } from "@/lib/api/schema";
import type { EpisodeStatus } from "@/lib/episode-status";

// Inbox de notificaciones (spec 003, sección 2). El mensaje lo arma el
// backend en español; acá solo se decide el tratamiento visual.

export type Notification = components["schemas"]["NotificationDto_Output"];
export type NotificationType = Notification["type"];

/**
 * Estado del episodio relacionado con cada tipo de notificación: el inbox lo
 * muestra con la etiqueta y la categoría visual de ese estado (AC 3.11). Con
 * un Record, un tipo nuevo en openapi.json hace fallar el build.
 */
export const NOTIFICATION_RELATED_STATUS: Readonly<Record<NotificationType, EpisodeStatus>> = {
  EPISODE_COMPLETED: "COMPLETED",
  EPISODE_PENDING_REVIEW: "PENDING_REVIEW",
  EPISODE_REQUIRES_REVIEW: "REQUIRES_HUMAN_REVIEW",
  EPISODE_FAILED: "FAILED",
};

/** De más nueva a más vieja (AC 3.11), sin depender del orden de la API. */
export function sortNotifications(notifications: readonly Notification[]): Notification[] {
  return [...notifications].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function isUnread(notification: Notification): boolean {
  return notification.readAt === null;
}

/** Texto del contador del header; más de 99 se muestra "99+". */
export function unreadBadgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}
