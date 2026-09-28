import { BadRequestException, Body, Controller, Get, MessageEvent, Param, Post, Query, Res, Sse } from "@nestjs/common";
import { ApiBody, ApiExcludeEndpoint, ApiExtraModels, ApiOperation, ApiResponse, ApiTags, getSchemaPath } from "@nestjs/swagger";
import { ZodResponse, ZodValidationPipe } from "nestjs-zod";
import { EMPTY, Observable } from "rxjs";
import type { Response } from "express";
import { ErrorResponseDto } from "../../shared/http/error-response.dto";
import { ApiErrorResponse } from "../../shared/http/api-error-response.decorator";
import { EpisodesService } from "./episodes.service";
import { EpisodeActionsService } from "./episode-actions.service";
import { TtsService } from "../tts/tts.service";
import { CreateEpisodeDto } from "./dto/create-episode.dto";
import { ListEpisodesQueryDto } from "./dto/list-episodes-query.dto";
import { ActionNameSchema, type ActionName } from "./dto/episode-action-name.dto";
import { EditActionDto } from "./dto/edit-action.dto";
import { RegenerateActionDto } from "./dto/regenerate-action.dto";
import { RegenerateAudioActionDto } from "./dto/regenerate-audio-action.dto";
import { ResumeActionBodyDto, ResumeActionBodySchema, type ResumeActionBody } from "./dto/resume-action.dto";
import { RegenerateVerdictActionDto } from "./dto/regenerate-verdict-action.dto";
import { EpisodeDto, EpisodeListItemDto, serializeEpisode } from "./dto/episode.schema";
import { ArgumentDto, serializeArgument } from "./dto/argument.schema";
import { AudioAssetDto, SignedAudioUrlDto, serializeAudioAsset } from "./dto/audio-asset.schema";
import { EpisodeDetailDto, EpisodeVerdictDto } from "./episode-detail.mapper";
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

// Descripciones de errores que se repiten entre endpoints (API-10). El
// schema de todas es ErrorResponseDto; la descripción dice qué `code` trae
// ese status en ese endpoint.
const EPISODE_NOT_FOUND = "`NOT_FOUND`: el episodio no existe.";
const INVALID_BODY = "`VALIDATION_ERROR`: body mal formado (falta un campo, tipo incorrecto o campos de más).";
const INVALID_STATE = "`INVALID_STATE_TRANSITION`: el episodio no está en un estado que admita la acción (api-contract.md §5).";
const PROVIDER_UNAVAILABLE =
  "`PROVIDER_QUOTA_EXCEEDED`: el proveedor no pudo atender la llamada (cuota diaria, espera del limitador por encima del tope, " +
  "TTS caído o circuit breaker abierto). Reintentar más tarde; no consume presupuesto.";
const PROVIDER_FAILED = "`INTERNAL_ERROR`: cualquier otra falla del proveedor. Los datos quedan como estaban.";

// api-contract.md §2/§3/§4. /episodes/:id/manifest (Feature 7, P0) — la
// mitad P1 de Render (worker de Remotion, Feature 9) sigue sin implementar.
//
// Validación de body/query (spec 001, docs/product/001-openapi-contract-zod.md):
// nestjs-zod's ZodValidationPipe está registrado global (AppModule) y valida
// automáticamente cualquier @Body()/@Query() tipado con una clase
// createZodDto (por reflection del tipo del parámetro) — no hace falta
// instanciarlo acá para esos casos. Dos excepciones usan la instancia
// manual (new ZodValidationPipe(schema)) del mismo pipe de nestjs-zod: el
// body de resume, que es una unión y no se puede tipar con su DTO
// (resume-action.dto.ts), y el path param `action` de la ruta de acciones
// desconocidas (ver unknownAction, al final de las acciones).
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
  @ApiErrorResponse(400, INVALID_BODY)
  @ApiErrorResponse(
    409,
    "`VOICE_NOT_CONFIGURED`: falta la voz de algún agente candidato para el idioma pedido y el proveedor de TTS activo. No se crea nada."
  )
  create(@Body() dto: CreateEpisodeDto) {
    return this.episodes.createEpisode(dto.topic, dto.language);
  }

  @Get()
  @ApiOperation({ operationId: "listEpisodes" })
  @ZodResponse({ status: 200, type: [EpisodeListItemDto] })
  @ApiErrorResponse(400, "`VALIDATION_ERROR`: algún valor del filtro `status` no es un EpisodeStatus.")
  list(@Query() query: ListEpisodesQueryDto) {
    return this.episodes.listEpisodes(query.status);
  }

  @Get(":id")
  @ApiOperation({ operationId: "getEpisodeDetail" })
  @ZodResponse({ status: 200, type: EpisodeDetailDto })
  @ApiErrorResponse(404, EPISODE_NOT_FOUND)
  detail(@Param("id") id: string) {
    return this.episodes.getEpisodeDetail(id);
  }

  // AC 6.1 (features.md Feature 6) — URL firmada de corta duración para un
  // AudioAsset puntual, scopeada al episodio (TtsService.getSignedAudioUrl
  // tira 404 si el audioAssetId no pertenece a este episodio).
  @Get(":id/audio/:audioAssetId/url")
  @ApiOperation({ operationId: "getEpisodeAudioUrl" })
  @ZodResponse({ status: 200, type: SignedAudioUrlDto, description: "URL firmada de `/audio-files`, vence a los `AUDIO_URL_TTL_SECONDS`." })
  @ApiErrorResponse(404, "`NOT_FOUND`: el episodio no existe o el `audioAssetId` no es de un argumento de este episodio.")
  getAudioUrl(@Param("id") id: string, @Param("audioAssetId") audioAssetId: string) {
    return this.tts.getSignedAudioUrl(id, audioAssetId);
  }

  // Feature 7 (P0) — solo tiene contenido significativo desde
  // READY_FOR_RENDER en adelante (api-contract.md §2); antes de eso,
  // ManifestNotReadyError -> 409 MANIFEST_NOT_READY (HttpErrorFilter).
  @Get(":id/manifest")
  @ApiOperation({ operationId: "getEpisodeManifest" })
  @ZodResponse({ status: 200, type: RemotionManifestDto })
  @ApiErrorResponse(404, EPISODE_NOT_FOUND)
  @ApiErrorResponse(409, "`MANIFEST_NOT_READY`: todavía no hay audio o veredicto para todos los argumentos oficiales.")
  getManifest(@Param("id") id: string) {
    return this.episodes.getManifest(id);
  }

  // Acciones de curaduría (api-contract.md §3): un handler por acción, todos
  // bajo la misma URL de siempre, POST /episodes/:id/actions/<acción> (API-10).
  // Antes era un único handler con `:action` como path param, que no podía
  // documentar un body ni una respuesta por acción (devuelven Episode,
  // Argument, AudioAsset o el veredicto). Con un handler por acción, cada una
  // tiene su operationId, su body (DTO validado por el pipe global) y su
  // @ZodResponse, y el dashboard tipa todo desde openapi.json (D5 de la spec
  // 003). Mantienen el 201 que ya respondían (default de Nest para POST).
  // Las filas de Prisma que devuelve EpisodeActionsService se serializan acá
  // (serializeEpisode/serializeArgument/serializeAudioAsset, fechas a ISO):
  // @ZodResponse exige en compilación que el handler devuelva el tipo del
  // schema documentado. El JSON resultante es el mismo de antes (Express ya
  // pasaba los Date a ISO).
  // Los estados válidos de cada acción los valida EpisodeActionsService
  // / EpisodeStateService (tabla de api-contract.md §5), no acá.

  @Post(":id/actions/approve")
  @ApiOperation({ operationId: "approveEpisode", summary: "Aprobar (PENDING_REVIEW → APPROVED). Sin body." })
  @ZodResponse({ status: 201, type: EpisodeDto, description: "El episodio, ya en APPROVED. La síntesis de audio arranca en segundo plano." })
  @ApiErrorResponse(404, EPISODE_NOT_FOUND)
  @ApiErrorResponse(409, INVALID_STATE)
  async approve(@Param("id") id: string) {
    return serializeEpisode(await this.actions.approve(id));
  }

  @Post(":id/actions/edit")
  @ApiOperation({ operationId: "editEpisodeArgument", summary: "Editar el texto de un argumento (solo PENDING_REVIEW)." })
  @ZodResponse({ status: 201, type: ArgumentDto, description: "El argumento editado (`origin: HUMAN_EDITED`)." })
  @ApiErrorResponse(400, INVALID_BODY)
  @ApiErrorResponse(404, "`NOT_FOUND`: el episodio no existe o el `argumentId` no es de un round de su debate. No se toca nada.")
  @ApiErrorResponse(409, INVALID_STATE)
  async edit(@Param("id") id: string, @Body() dto: EditActionDto) {
    return serializeArgument(await this.actions.edit(id, dto));
  }

  @Post(":id/actions/regenerate")
  @ApiOperation({
    operationId: "regenerateEpisodeArgument",
    summary: "Regenerar un argumento con su agente (solo PENDING_REVIEW). Sincrónica: puede tardar ~90 s.",
  })
  @ZodResponse({ status: 201, type: ArgumentDto, description: "El argumento con el texto nuevo (`origin: AI_GENERATED`)." })
  @ApiErrorResponse(400, INVALID_BODY)
  @ApiErrorResponse(404, "`NOT_FOUND`: el episodio no existe o el `argumentId` no es de un round de su debate. No se toca nada.")
  @ApiErrorResponse(409, `${INVALID_STATE} \`USAGE_LIMIT_EXCEEDED\`: presupuesto de llamadas LLM agotado.`)
  @ApiErrorResponse(500, PROVIDER_FAILED)
  @ApiErrorResponse(503, PROVIDER_UNAVAILABLE)
  async regenerate(@Param("id") id: string, @Body() dto: RegenerateActionDto) {
    return serializeArgument(await this.actions.regenerate(id, dto));
  }

  @Post(":id/actions/reject")
  @ApiOperation({ operationId: "rejectEpisode", summary: "Rechazar (PENDING_REVIEW o REQUIRES_HUMAN_REVIEW → CANCELLED). Sin body." })
  @ZodResponse({ status: 201, type: EpisodeDto, description: "El episodio, ya en CANCELLED." })
  @ApiErrorResponse(404, EPISODE_NOT_FOUND)
  @ApiErrorResponse(409, INVALID_STATE)
  async reject(@Param("id") id: string) {
    return serializeEpisode(await this.actions.reject(id));
  }

  // El body depende del `reason` del checkpoint activo (api-contract.md §3):
  // ResumeActionBodySchema valida que sea alguna de las 3 formas y
  // EpisodeActionsService.resume, que sea la de ese reason.
  @Post(":id/actions/resume")
  @ApiOperation({
    operationId: "resumeEpisode",
    summary: "Reanudar desde el checkpoint (solo REQUIRES_HUMAN_REVIEW).",
    description:
      "El body depende de `reason` del último checkpoint (GET /episodes/:id): `USAGE_LIMIT_EXCEEDED` → UsageLimitResumeBody " +
      "(al menos uno de los límites); `INSUFFICIENT_EVIDENCE` → InsufficientEvidenceResumeBody; `MAX_REVISIONS_EXCEEDED`, " +
      "`VALIDATION_INCONSISTENCY`, `PROVIDER_QUOTA_EXCEEDED` y `VOICE_NOT_CONFIGURED` → EmptyResumeBody (`{}`). " +
      "Un body válido pero de otro motivo es 400.",
  })
  @ApiBody({ type: ResumeActionBodyDto })
  @ZodResponse({ status: 201, type: EpisodeDto, description: "El episodio, ya en el estado del checkpoint. El pipeline sigue en segundo plano." })
  @ApiErrorResponse(400, "`VALIDATION_ERROR`: el body no es ninguna de las 3 formas, o no es la que corresponde al `reason` del checkpoint.")
  @ApiErrorResponse(404, EPISODE_NOT_FOUND)
  @ApiErrorResponse(409, `${INVALID_STATE} Se valida antes de tocar los límites (API-15).`)
  async resume(@Param("id") id: string, @Body(new ZodValidationPipe(ResumeActionBodySchema)) body: ResumeActionBody) {
    return serializeEpisode(await this.actions.resume(id, body));
  }

  @Post(":id/actions/regenerate-audio")
  @ApiOperation({
    operationId: "regenerateEpisodeAudio",
    summary: "Regenerar el audio de un segmento (solo READY_FOR_RENDER). Sincrónica.",
  })
  @ZodResponse({ status: 201, type: AudioAssetDto, description: "El AudioAsset nuevo; el anterior se borra." })
  @ApiErrorResponse(
    400,
    `${INVALID_BODY} \`INVALID_SEQUENCE_INDEX\`: \`sequenceIndex\` fuera de rango (1-based, mismo orden que \`timeline\` del manifest).`
  )
  @ApiErrorResponse(404, EPISODE_NOT_FOUND)
  @ApiErrorResponse(
    409,
    `${INVALID_STATE} \`USAGE_LIMIT_EXCEEDED\`: presupuesto de TTS agotado. ` +
      "`VOICE_NOT_CONFIGURED`: falta la voz del agente para el idioma del episodio y el proveedor activo. En todos los casos el segmento queda como estaba."
  )
  @ApiErrorResponse(500, PROVIDER_FAILED)
  @ApiErrorResponse(503, PROVIDER_UNAVAILABLE)
  async regenerateAudio(@Param("id") id: string, @Body() dto: RegenerateAudioActionDto) {
    return serializeAudioAsset(await this.actions.regenerateAudio(id, dto));
  }

  @Post(":id/actions/regenerate-verdict")
  @ApiOperation({
    operationId: "regenerateEpisodeVerdict",
    summary: "Volver a juzgar (solo PENDING_REVIEW). Body `{}` estricto. Sincrónica: puede tardar ~90 s.",
  })
  @ZodResponse({ status: 201, type: EpisodeVerdictDto, description: "El veredicto nuevo, con el shape de `debate.verdict` del detalle." })
  @ApiErrorResponse(400, "`VALIDATION_ERROR`: sin body o con campos de más.")
  @ApiErrorResponse(404, EPISODE_NOT_FOUND)
  @ApiErrorResponse(
    409,
    `${INVALID_STATE} También si el estado cambió mientras corría la llamada al juez. \`USAGE_LIMIT_EXCEEDED\`: presupuesto de llamadas LLM agotado.`
  )
  @ApiErrorResponse(500, "`INTERNAL_ERROR`: cualquier otra falla del juez. El veredicto anterior queda intacto.")
  @ApiErrorResponse(503, PROVIDER_UNAVAILABLE)
  regenerateVerdict(@Param("id") id: string, @Body() _body: RegenerateVerdictActionDto) {
    return this.actions.regenerateVerdict(id);
  }

  // Cualquier otro valor de `:action`: 400 VALIDATION_ERROR, como antes de
  // API-10, cuando `action` era path param validado con ActionNameSchema (sin
  // esta ruta sería un 404 de Nest). Va DESPUÉS de las 7 rutas de arriba:
  // Express prueba las rutas en el orden en que Nest las registra (el de
  // declaración de los métodos), así que un nombre desconocido falla en el
  // pipe con el mismo mensaje de antes. Fuera de openapi.json: no es una
  // operación. Tiene que seguir siendo el último @Post del controller (lo
  // verifica episodes.controller.spec.ts): una acción declarada debajo
  // quedaría tapada por esta ruta.
  // Un nombre válido sí puede llegar acá si viene con percent-encoding
  // (`appr%6Fve`, `regenerate%2Daudio`): no matchea la ruta literal, pero
  // `:action` llega decodificado y pasa el pipe. No es una falla del
  // servidor sino una URL distinta de la documentada: 400 VALIDATION_ERROR
  // (BadRequestException, vía HttpErrorFilter), no un 500.
  @Post(":id/actions/:action")
  @ApiExcludeEndpoint()
  unknownAction(@Param("action", new ZodValidationPipe(ActionNameSchema)) action: ActionName): never {
    throw new BadRequestException(
      `action: la acción "${action}" tiene que ir literal en la URL (/actions/${action}), sin caracteres codificados.`
    );
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
