import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { NotificationsService } from "./notifications.service";
import { ListNotificationsQueryDto } from "./dto/list-notifications-query.dto";

// Validación de query vía el pipe global de nestjs-zod (spec 001) — no hace
// falta instanciarlo acá, ListNotificationsQueryDto ya es una clase
// createZodDto.
@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ operationId: "listNotifications" })
  list(@Query() query: ListNotificationsQueryDto) {
    return this.notifications.list(query.unreadOnly ?? true);
  }

  @Post(":id/read")
  @ApiOperation({ operationId: "markNotificationRead" })
  read(@Param("id") id: string) {
    return this.notifications.markRead(id);
  }

  @Post("read-all")
  @ApiOperation({ operationId: "markAllNotificationsRead" })
  readAll() {
    return this.notifications.markAllRead();
  }
}
