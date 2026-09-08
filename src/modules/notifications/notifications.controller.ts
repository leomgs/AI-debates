import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../../shared/http/zod-validation.pipe";
import { NotificationsService } from "./notifications.service";
import { ListNotificationsQuerySchema, type ListNotificationsQueryDto } from "./dto/list-notifications-query.dto";

@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(ListNotificationsQuerySchema)) query: ListNotificationsQueryDto) {
    return this.notifications.list(query.unreadOnly ?? true);
  }

  @Post(":id/read")
  read(@Param("id") id: string) {
    return this.notifications.markRead(id);
  }

  @Post("read-all")
  readAll() {
    return this.notifications.markAllRead();
  }
}
