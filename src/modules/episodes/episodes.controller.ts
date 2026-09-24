import { Body, Controller, Get, MessageEvent, Param, Post, Query, Sse } from "@nestjs/common";
import { Observable } from "rxjs";
import { ZodValidationPipe } from "../../shared/http/zod-validation.pipe";
import { EpisodesService } from "./episodes.service";
import { EpisodeActionsService } from "./episode-actions.service";
import { EpisodeEventsService } from "./episode-events.service";
import { TtsService } from "../tts/tts.service";
import { CreateEpisodeSchema, type CreateEpisodeDto } from "./dto/create-episode.dto";
import { ListEpisodesQuerySchema, type ListEpisodesQueryDto } from "./dto/list-episodes-query.dto";
import { ActionNameSchema, type ActionName } from "./dto/episode-action-name.dto";
import { EditActionSchema } from "./dto/edit-action.dto";
import { RegenerateActionSchema } from "./dto/regenerate-action.dto";
import { RegenerateAudioActionSchema } from "./dto/regenerate-audio-action.dto";
import { ResumeActionBodySchema } from "./dto/resume-action.dto";

// api-contract.md §2/§3/§4. /episodes/:id/manifest (Feature 7, P0) — la
// mitad P1 de Render (worker de Remotion, Feature 9) sigue sin implementar.
@Controller("episodes")
export class EpisodesController {
  constructor(
    private readonly episodes: EpisodesService,
    private readonly actions: EpisodeActionsService,
    private readonly events: EpisodeEventsService,
    private readonly tts: TtsService
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

  // AC 6.1 (features.md Feature 6) — URL firmada de corta duración para un
  // AudioAsset puntual, scopeada al episodio (TtsService.getSignedAudioUrl
  // tira 404 si el audioAssetId no pertenece a este episodio).
  @Get(":id/audio/:audioAssetId/url")
  getAudioUrl(@Param("id") id: string, @Param("audioAssetId") audioAssetId: string) {
    return this.tts.getSignedAudioUrl(id, audioAssetId);
  }

  // Feature 7 (P0) — solo tiene contenido significativo desde
  // READY_FOR_RENDER en adelante (api-contract.md §2); antes de eso,
  // ManifestNotReadyError -> 409 MANIFEST_NOT_READY (HttpErrorFilter).
  @Get(":id/manifest")
  getManifest(@Param("id") id: string) {
    return this.episodes.getManifest(id);
  }

  // Un solo endpoint para las acciones (api-contract.md §3) — cada rama
  // valida su propio DTO; el path param `action` ya viene acotado a los
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
      case "regenerate-audio":
        return this.actions.regenerateAudio(id, RegenerateAudioActionSchema.parse(body));
    }
  }

  @Sse(":id/events")
  streamEvents(@Param("id") id: string): Observable<MessageEvent> {
    return this.events.stream(id);
  }
}
