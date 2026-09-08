import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";

// Módulo standalone (no vive dentro de episodes/) — es un recurso HTTP
// distinto (/notifications), respeta "un controller por módulo"
// (coding-rules.md §1). EpisodesModule lo importa para inyectar
// NotificationsService en EpisodeStateService (decision-log.md 2026-09-08 #9).
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
