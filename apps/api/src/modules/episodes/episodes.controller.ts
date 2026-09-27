import { Body, Controller, Get, MessageEvent, Param, Post, Query, Res, Sse } from "@nestjs/common";
import { ApiExtraModels, ApiOperation, ApiResponse, ApiTags, getSchemaPath } from "@nestjs/swagger";
import { ZodResponse, ZodValidationPipe } from "nestjs-zod";
import { EMPTY, Observable } from "rxjs";
import type { Response } from "express";
import { ErrorResponseDto } from "../../shared/http/error-response.dto";
import { EpisodesService } from "./episodes.service";
import { EpisodeActionsService } from "./episode-actions.service";
import { TtsService } from "../tts/tts.service";
import { CreateEpisodeDto } from "./dto/create-episode.dto";
import { ListEpisodesQueryDto } from "./dto/list-episodes-query.dto";
import { ActionNameSchema, type ActionName } from "./dto/episode-action-name.dto";
import { EditActionSchema } from "./dto/edit-action.dto";
import { RegenerateActionSchema } from "./dto/regenerate-action.dto";
import { RegenerateAudioActionSchema } from "./dto/regenerate-audio-action.dto";
import { ResumeActionBodySchema } from "./dto/resume-action.dto";
import { RegenerateVerdictActionSchema } from "./dto/regenerate-verdict-action.dto";
import { EpisodeDto, EpisodeListItemDto } from "./dto/episode.schema";
import { EpisodeDetailDto } from "./episode-detail.mapper";
import { RemotionManifestDto } from "../render/remotion-manifest.dto";
import {
  ResearchStartedEventDto,
  AgentThinkingEventDto,
  FactCheckCompletedEventDto,
  ArgumentApprovedEventDto,
  EpisodePendingReviewEventDto,
  EpisodeRequiresReviewEventDto,
  HeartbeatEventDto,
} from "./dto/episode-sse-event.schema";

const SSE_EVENT_DTOS = [
  ResearchStartedEventDto,
  AgentThinkingEventDto,
  FactCheckCompletedEventDto,
  ArgumentApprovedEventDto,
  EpisodePendingReviewEventDto,
  EpisodeRequiresReviewEventDto,
  HeartbeatEventDto,
] as const;

// api-contract.md §2/§3/§4. /episodes/:id/manifest (Feature 7, P0) — la
// mitad P1 de Render (worker de Remotion, Feature 9) sigue sin implementar.
//
// Validación de body/query (spec 001, docs/product/001-openapi-contract-zod.md):
// nestjs-zod's ZodValidationPipe está registrado global (AppModule) y valida
// automáticamente cualquier @Body()/@Query() tipado con una clase
// createZodDto (por reflection del tipo del parámetro) — no hace falta
// instanciarlo acá para esos casos. El path param `action` es la única
// excepción real: no es un DTO de objeto, es un enum de string suelto, así
// que sigue necesitando la instancia manual (new ZodValidationPipe(schema)) —
// el mismo pipe de nestjs-zod también soporta ese modo, no hace falta un
// pipe propio del proyecto para esto (ver decision-log.md, spec 001).
@ApiTags("episodes")
@Controller("episodes")
export class EpisodesController {
  constructor(
    private readonly episodes: EpisodesService,
    private readonly actions: EpisodeActionsService,
    private readonly tts: TtsService
  ) {}

  @Post()
  @ApiOperation({ operationId: "createEpisode" })
  @ZodResponse({ status: 201, type: EpisodeDto })
  create(@Body() dto: CreateEpisodeDto) {
    return this.episodes.createEpisode(dto.topic, dto.language);
  }

  @Get()
  @ApiOperation({ operationId: "listEpisodes" })
  @ZodResponse({ status: 200, type: [EpisodeListItemDto] })
  list(@Query() query: ListEpisodesQueryDto) {
    return this.episodes.listEpisodes(query.status);
  }

  @Get(":id")
  @ApiOperation({ operationId: "getEpisodeDetail" })
  @ZodResponse({ status: 200, type: EpisodeDetailDto })
  detail(@Param("id") id: string) {
    return this.episodes.getEpisodeDetail(id);
  }

  // AC 6.1 (features.md Feature 6) — URL firmada de corta duración para un
  // AudioAsset puntual, scopeada al episodio (TtsService.getSignedAudioUrl
  // tira 404 si el audioAssetId no pertenece a este episodio).
  @Get(":id/audio/:audioAssetId/url")
  @ApiOperation({ operationId: "getEpisodeAudioUrl" })
  getAudioUrl(@Param("id") id: string, @Param("audioAssetId") audioAssetId: string) {
    return this.tts.getSignedAudioUrl(id, audioAssetId);
  }

  // Feature 7 (P0) — solo tiene contenido significativo desde
  // READY_FOR_RENDER en adelante (api-contract.md §2); antes de eso,
  // ManifestNotReadyError -> 409 MANIFEST_NOT_READY (HttpErrorFilter).
  @Get(":id/manifest")
  @ApiOperation({ operationId: "getEpisodeManifest" })
  @ZodResponse({ status: 200, type: RemotionManifestDto })
  getManifest(@Param("id") id: string) {
    return this.episodes.getManifest(id);
  }

  // Un solo endpoint para las acciones (api-contract.md §3) — cada rama
  // valida su propio DTO; el path param `action` ya viene acotado a los
  // valores válidos por ActionNameSchema (cualquier otro valor es 400 antes
  // de llegar acá). Sin @ZodResponse a propósito (spec 001, alcance): las 7
  // ramas devuelven 4 shapes distintos (Episode/Argument/AudioAsset y, desde
  // API-19, el veredicto de EpisodeVerdictSchema) y este
  // método único no puede declarar uno solo sin mentir sobre las otras —
  // documentar esto correctamente (unión, o separar el endpoint) queda fuera
  // del alcance de esta primera pasada.
  @Post(":id/actions/:action")
  @ApiOperation({ operationId: "runEpisodeAction" })
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
      case "regenerate-verdict":
        RegenerateVerdictActionSchema.parse(body);
        return this.actions.regenerateVerdict(id);
    }
  }

  // Feature 8 — OpenAPI no modela streams SSE (spec 001, restricción
  // técnica): se documenta el content-type real (text/event-stream) con un
  // oneOf manual sobre los 7 DTOs de evento, registrados en
  // components.schemas vía @ApiExtraModels (EpisodeSseEventSchema, la unión,
  // no se puede envolver en un solo DTO — ver episode-sse-event.schema.ts).
  //
  // Cache-Control: `no-transform` (API-13) ya lo pone Nest en todo @Sse
  // (SseStream.commitHeaders, @nestjs/core 11: "private, no-cache, no-store,
  // must-revalidate, max-age=0, no-transform", más X-Accel-Buffering: no), y
  // no se puede pisar desde acá: los headers propios se aplican antes que
  // los de Nest. Lo cubre un test e2e (test/episodes.e2e-spec.ts).
  //
  // 204/404 (decisión del usuario tras el review F2-1): el handler es async
  // y verifica que el episodio exista antes de devolver el stream (un P2025
  // llega a HttpErrorFilter como 404, antes de abrir el SSE). Sin pipeline
  // activo responde 204: Nest toma el status de `res.statusCode` al armar la
  // respuesta SSE, y con EMPTY el stream termina sin escribir las cabeceras
  // de text/event-stream. Para EventSource un 204 es "no reconectar".
  @Sse(":id/events")
  @ApiOperation({ operationId: "streamEpisodeEvents" })
  @ApiExtraModels(...SSE_EVENT_DTOS)
  @ApiResponse({
    status: 200,
    description:
      "Server-Sent Events (Feature 8) — cada `event:` corresponde a uno de los 7 schemas listados. " +
      "Solo mientras hay una ejecución del pipeline en curso (`pipelineActive: true` en el detalle): llega un `heartbeat` cada 15 s, " +
      "que no es un evento de negocio, y el stream cierra cuando la ejecución termina.",
    content: {
      "text/event-stream": {
        schema: { oneOf: SSE_EVENT_DTOS.map((dto) => ({ $ref: getSchemaPath(dto) })) },
      },
    },
  })
  @ApiResponse({
    status: 204,
    description: "El episodio existe pero no hay una ejecución del pipeline en curso: sin body y sin stream (no hay nada que escuchar).",
  })
  @ApiResponse({ status: 404, type: ErrorResponseDto, description: "`NOT_FOUND`: el episodio no existe." })
  async streamEvents(@Param("id") id: string, @Res({ passthrough: true }) res: Response): Promise<Observable<MessageEvent>> {
    const stream = await this.episodes.streamEpisodeEvents(id);
    if (!stream) {
      res.status(204);
      return EMPTY;
    }
    return stream;
  }
}
