import { z } from "zod";
import { createZodDto } from "nestjs-zod";

// Valores exactos de schema.prisma:NotificationType — mismo criterio que
// EpisodeStatusSchema/CheckpointReasonSchema (episodes/dto), única fuente
// para no repetir el enum a mano.
export const NotificationTypeSchema = z.enum([
  "EPISODE_COMPLETED",
  "EPISODE_PENDING_REVIEW",
  "EPISODE_REQUIRES_REVIEW",
  "EPISODE_FAILED",
]);

// API-5 (spec 003, AC 3.10-3.14): mirror 1:1 de schema.prisma:Notification,
// para que el inbox del dashboard se tipe desde openapi.json. Fechas como
// string ISO, no z.date() (Zod 4 no puede representarlo en JSON Schema,
// mismo motivo que EpisodeSchema); NotificationsService serializa.
export const NotificationSchema = z.object({
  id: z.string().uuid(),
  episodeId: z.string().uuid(),
  type: NotificationTypeSchema,
  // Texto ya armado al crear la fila (decision-log.md #9); el front no lo
  // deriva de `type`.
  message: z.string(),
  // null = no leída.
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

// GET /notifications y POST /notifications/:id/read.
export class NotificationDto extends createZodDto(NotificationSchema) {}
export type SerializedNotification = z.infer<typeof NotificationSchema>;

// POST /notifications/read-all. Antes respondía sin body; se devuelve la
// cantidad que devuelve updateMany para que la respuesta tenga un schema
// (API-5) sin inventar datos: cuántas notificaciones no leídas se marcaron.
export const MarkAllNotificationsReadSchema = z.object({
  count: z.number().int().nonnegative(),
});

export class MarkAllNotificationsReadDto extends createZodDto(MarkAllNotificationsReadSchema) {}
export type MarkAllNotificationsReadResponse = z.infer<typeof MarkAllNotificationsReadSchema>;
