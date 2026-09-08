import { Body, Controller, Get, MessageEvent, Param, Post, Query, Sse } from "@nestjs/common";
import { Observable } from "rxjs";
import { ZodValidationPipe } from "../../shared/http/zod-validation.pipe";
import { EpisodesService } from "./episodes.service";
import { EpisodeActionsService } from "./episode-actions.service";
import { EpisodeEventsService } from "./episode-events.service";
import { CreateEpisodeSchema, type CreateEpisodeDto } from "./dto/create-episode.dto";
import { ListEpisodesQuerySchema, type ListEpisodesQueryDto } from "./dto/list-episodes-query.dto";
import { ActionNameSchema, type ActionName } from "./dto/episode-action-name.dto";
import { EditActionSchema } from "./dto/edit-action.dto";
import { RegenerateActionSchema } from "./dto/regenerate-action.dto";
import { ResumeActionBodySchema } from "./dto/resume-action.dto";

// api-contract.md §2/§3/§4. /episodes/:id/manifest y
// /episodes/:id/audio/:audioAssetId/url NO se implementan — dependen de
// TTS/Render, que no existen (fuera de scope de EpisodesModule).
@Controller("episodes")
export class EpisodesController {
  constructor(
    private readonly episodes: EpisodesService,
    private readonly actions: EpisodeActionsService,
    private readonly events: EpisodeEventsService
  ) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateEpisodeSchema)) dto: CreateEpisodeDto) {
    return this.episodes.createEpisode(dto.topic);
  }

  @Get()
  list(@Query(new ZodValidationPipe(ListEpisodesQuerySchema)) query: ListEpisodesQueryDto) {
    return this.episodes.listEpisodes(query.status);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.episodes.getEpisodeDetail(id);
  }

  // Un solo endpoint para las 5 acciones (api-contract.md §3) — cada rama
  // valida su propio DTO; el path param `action` ya viene acotado a los 5
  // valores válidos por ActionNameSchema (cualquier otro valor es 400 antes
  // de llegar acá).
  @Post(":id/actions/:action")
  runAction(
    @Param("id") id: string,
    @Param("action", new ZodValidationPipe(ActionNameSchema)) action: ActionName,
    @Body() body: unknown
  ) {
    switch (action) {
      case "approve":
        return this.actions.approve(id);
      case "edit":
        return this.actions.edit(id, EditActionSchema.parse(body));
      case "regenerate":
        return this.actions.regenerate(id, RegenerateActionSchema.parse(body));
      case "reject":
        return this.actions.reject(id);
      case "resume":
        return this.actions.resume(id, ResumeActionBodySchema.parse(body));
    }
  }

  @Sse(":id/events")
  streamEvents(@Param("id") id: string): Observable<MessageEvent> {
    return this.events.stream(id);
  }
}
