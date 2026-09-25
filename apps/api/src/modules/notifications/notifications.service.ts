import { Injectable } from "@nestjs/common";
import { Notification, NotificationType } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import type { MarkAllNotificationsReadResponse, SerializedNotification } from "./dto/notification.schema";

// Mensajes legibles por tipo — se arman UNA vez al crear la fila (no se
// derivan en el frontend a partir de `type`), decision-log.md 2026-09-08 #9.
// contextDetail lleva el detalle específico disponible en el momento
// (CheckpointReason para REQUIRES_REVIEW, o vacío para los demás).
function buildMessage(type: NotificationType, contextDetail?: string): string {
  switch (type) {
    case "EPISODE_COMPLETED":
      return "El episodio se completó.";
    case "EPISODE_PENDING_REVIEW":
      return "El episodio está listo para revisión.";
    case "EPISODE_REQUIRES_REVIEW":
      return `El episodio requiere revisión: ${contextDetail ?? "motivo no especificado"}.`;
    case "EPISODE_FAILED":
      return `El episodio falló definitivamente: ${contextDetail ?? "motivo no especificado"}.`;
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

// Inbox persistente, complementario al SSE de EpisodeEventsService (que es
// en vivo/efímero) — decision-log.md 2026-09-08 #9. Acoplado 1:1 a Episode,
// sin paginación (volumen bajo, single-user).
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async notify(episodeId: string, type: NotificationType, contextDetail?: string): Promise<Notification> {
    return this.prisma.notification.create({
      data: { episodeId, type, message: buildMessage(type, contextDetail) },
    });
  }

  async list(unreadOnly: boolean): Promise<SerializedNotification[]> {
    const rows = await this.prisma.notification.findMany({
      where: unreadOnly ? { readAt: null } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map(serialize);
  }

  async markRead(id: string): Promise<SerializedNotification> {
    return serialize(await this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } }));
  }

  async markAllRead(): Promise<MarkAllNotificationsReadResponse> {
    const { count } = await this.prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } });
    return { count };
  }
}

// Borde HTTP (API-5): fechas a ISO, igual que EpisodesService con Episode.
// notify() sigue devolviendo la fila de Prisma: su caller es interno
// (EpisodeStateService), no un controller.
function serialize(n: Notification): SerializedNotification {
  return {
    id: n.id,
    episodeId: n.episodeId,
    type: n.type,
    message: n.message,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}
