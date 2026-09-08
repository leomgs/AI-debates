import { Module } from "@nestjs/common";
import { NotificationsModule } from "../notifications/notifications.module";
import { ResearchModule } from "../research/research.module";
import { DebateModule } from "../debate/debate.module";
import { AgentsModule } from "../agents/agents.module";
import { FactCheckModule } from "../fact-check/fact-check.module";
import { EpisodeStateService } from "./episode-state.service";
import { EpisodeBudgetService } from "./episode-budget.service";
import { EpisodeParticipantsService } from "./episode-participants.service";
import { EpisodeOrchestratorService } from "./episode-orchestrator.service";
import { EpisodeEventsService } from "./episode-events.service";
import { EpisodeActionsService } from "./episode-actions.service";
import { EpisodeRecoveryService } from "./episode-recovery.service";
import { EpisodesService } from "./episodes.service";
import { EpisodesController } from "./episodes.controller";

// Se va extendiendo por fase (ver decision-log.md / tasks.md §7), no
// reescribiendo. EpisodeRecoveryService (Fase E) se registra como provider
// simple — Nest ejecuta OnApplicationBootstrap de cualquier provider
// declarado en el árbol de módulos, no hace falta exportarlo ni instanciarlo
// a mano en ningún lado.
@Module({
  imports: [NotificationsModule, ResearchModule, DebateModule, AgentsModule, FactCheckModule],
  controllers: [EpisodesController],
  providers: [
    EpisodeStateService,
    EpisodeBudgetService,
    EpisodeParticipantsService,
    EpisodeOrchestratorService,
    EpisodeEventsService,
    EpisodeActionsService,
    EpisodeRecoveryService,
    EpisodesService,
  ],
  exports: [EpisodeStateService, EpisodeBudgetService, EpisodeParticipantsService, EpisodesService],
})
export class EpisodesModule {}
