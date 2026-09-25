import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import { NotificationsService } from "./notifications.service";
import { ListNotificationsQueryDto } from "./dto/list-notifications-query.dto";
import { MarkAllNotificationsReadDto, NotificationDto } from "./dto/notification.schema";

// Validación de query vía el pipe global de nestjs-zod (spec 001) — no hace
// falta instanciarlo acá, ListNotificationsQueryDto ya es una clase
// createZodDto.
//
// API-5 (spec 003): las 3 respuestas documentadas con @ZodResponse para que
// el inbox del dashboard se tipe desde openapi.json. Los dos POST conservan
// el 201 que ya respondían (default de Nest para POST).
@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ operationId: "listNotifications" })
  @ZodResponse({ status: 200, type: [NotificationDto] })
  list(@Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(query.unreadOnly ?? true);
  }

  @Post(":id/read")
  @ApiOperation({ operationId: "markNotificationRead" })
  @ZodResponse({ status: 201, type: NotificationDto, description: "La notificación, con `readAt` ya seteado." })
  read(@Param("id") id: string) {
    return this.notifications.markRead(id);
  }

  @Post("read-all")
  @ApiOperation({ operationId: "markAllNotificationsRead" })
  @ZodResponse({
    status: 201,
    type: MarkAllNotificationsReadDto,
    description: "Cantidad de notificaciones no leídas que se marcaron como leídas.",
  })
  readAll() {
    return this.notifications.markAllRead();
  }
}
