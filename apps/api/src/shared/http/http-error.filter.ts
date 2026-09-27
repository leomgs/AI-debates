import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ZodValidationException } from "nestjs-zod";
import { BrokenCircuitError } from "cockatiel";
import { BudgetExceededError, InvalidEpisodeTransitionError } from "../../modules/episodes/episodes.errors";
import { SequenceIndexOutOfRangeError, TtsProviderUnavailableError, VoiceNotConfiguredError } from "../../modules/tts/tts.errors";
import { DailyQuotaExceededError, RateLimitWaitExceededError } from "../../modules/ai/ai.errors";
import { ManifestNotReadyError } from "../../modules/render/render.errors";
import { InvalidCredentialsError, LoginBusyError, TooManyLoginAttemptsError } from "../../modules/auth/auth.errors";

// Reusado por los dos branches que terminan en 400 VALIDATION_ERROR: el
// ZodError "crudo" del pipe propio (path param `action`) y el que envuelve
// ZodValidationException (nestjs-zod, spec 001 — su pipe global lanza esta
// excepción, no un ZodError directo, así que sin este branch el error caería
// al genérico de HttpException más abajo con code "ZODVALIDATION" en vez de
// "VALIDATION_ERROR").
function formatZodIssue(error: ZodError): string {
  const first = error.issues[0];
  return first ? `${first.path.join(".")}: ${first.message}` : "Payload inválido.";
}

// Formato de error HTTP consistente en todo el backend (api-contract.md §1,
// tasks.md §9): { error: { code, message } }. EpisodesModule es el primer
// módulo con superficie HTTP real, así que resuelve este pendiente de paso.
// Se registra global en main.ts (app.useGlobalFilters(new HttpErrorFilter())) —
// wiring final en Fase E, junto con el resto del bootstrap de AppModule.
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, code, message, headers } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(message, exception instanceof Error ? exception.stack : exception);
    }

    for (const [name, value] of Object.entries(headers ?? {})) response.setHeader(name, value);
    response.status(status).json({ error: { code, message } });
  }

  private resolve(exception: unknown): { status: number; code: string; message: string; headers?: Record<string, string> } {
    if (exception instanceof InvalidEpisodeTransitionError) {
      return { status: 409, code: "INVALID_STATE_TRANSITION", message: exception.message };
    }

    // AC 6.2 (etapa 3 de TTS) — sequenceIndex fuera de rango en
    // POST /episodes/:id/actions/regenerate-audio es un payload mal formado
    // para el episodio actual, no un conflicto de estado.
    if (exception instanceof SequenceIndexOutOfRangeError) {
      return { status: 400, code: "INVALID_SEQUENCE_INDEX", message: exception.message };
    }

    // Feature 7 — GET /episodes/:id/manifest antes de que exista audio/veredicto
    // para todos los Argument OFFICIAL: conflicto con el estado actual de los
    // datos, no un payload inválido (mismo status class que INVALID_STATE_TRANSITION).
    if (exception instanceof ManifestNotReadyError) {
      return { status: 409, code: "MANIFEST_NOT_READY", message: exception.message };
    }

    // Spec 004, D15 (ADR 0002 punto 4): falta la voz de algún agente para el
    // idioma y el proveedor activo. En createEpisode (antes de crear filas),
    // en regenerate-audio (el segmento queda como estaba, AC 4.15). El manifest
    // nunca lo emite: informa la voz guardada o null (D17 revisado).
    // Es un conflicto con los datos cargados, no un bug: 409. El mensaje ya
    // nombra el idioma, el proveedor y los agentes sin voz.
    if (exception instanceof VoiceNotConfiguredError) {
      return { status: 409, code: "VOICE_NOT_CONFIGURED", message: exception.message };
    }

    // API-10b (spec 003, AC 3.50/3.62/3.85): las acciones sincrónicas que
    // llaman a un proveedor (regenerate, regenerate-verdict,
    // regenerate-audio) no pasan por handlePipelineError del orquestador,
    // así que estos errores llegaban acá como 500. Presupuesto del episodio
    // agotado: conflicto con el estado de los datos (en PENDING_REVIEW o
    // READY_FOR_RENDER no hay forma de subir los límites), mismo `code` que
    // el CheckpointReason equivalente.
    if (exception instanceof BudgetExceededError) {
      return { status: 409, code: "USAGE_LIMIT_EXCEEDED", message: exception.message };
    }

    // Mismo conjunto que el orquestador mapea a PROVIDER_QUOTA_EXCEEDED
    // (episode-orchestrator.service.ts, handlePipelineError): cuota diaria
    // del LLM, espera del rate limiter por encima del tope y TTS caído. Es
    // una indisponibilidad temporal del proveedor, no un bug: 503.
    if (
      exception instanceof DailyQuotaExceededError ||
      exception instanceof RateLimitWaitExceededError ||
      exception instanceof TtsProviderUnavailableError
    ) {
      return { status: 503, code: "PROVIDER_QUOTA_EXCEEDED", message: exception.message };
    }

    // Review F2-2: el circuit breaker de Cockatiel (una policy por módulo,
    // coding-rules.md §4) quedó abierto tras fallos consecutivos del
    // proveedor y rechaza la llamada sin intentarla. Es la misma situación
    // para el curador (el proveedor no está disponible, reintentar más tarde)
    // y sin esto salía un 500 con el mensaje en inglés de la librería. Solo
    // cambia la respuesta HTTP: el orquestador no se toca.
    if (exception instanceof BrokenCircuitError) {
      return {
        status: 503,
        code: "PROVIDER_QUOTA_EXCEEDED",
        message: "El proveedor de IA falló varias veces seguidas y se pausaron las llamadas por unos segundos. Reintentá más tarde.",
      };
    }

    // API-8 (spec 003, AC 3.2/3.8) — login rechazado. La falta de sesión en
    // el resto de la API no pasa por acá: el SessionGuard lanza
    // UnauthorizedException, que el branch genérico de HttpException de
    // abajo convierte en 401 UNAUTHORIZED.
    if (exception instanceof InvalidCredentialsError) {
      return { status: 401, code: "INVALID_CREDENTIALS", message: exception.message };
    }

    if (exception instanceof LoginBusyError) {
      return {
        status: 429,
        code: "LOGIN_BUSY",
        message: exception.message,
        headers: { "Retry-After": String(exception.retryAfterSeconds) },
      };
    }

    if (exception instanceof TooManyLoginAttemptsError) {
      return {
        status: 429,
        code: "TOO_MANY_ATTEMPTS",
        message: exception.message,
        headers: { "Retry-After": String(exception.retryAfterSeconds) },
      };
    }

    if (exception instanceof ZodError) {
      return { status: 400, code: "VALIDATION_ERROR", message: formatZodIssue(exception) };
    }

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError();
      const message = zodError instanceof ZodError ? formatZodIssue(zodError) : exception.message;
      return { status: 400, code: "VALIDATION_ERROR", message };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === "P2025") {
      return { status: 404, code: "NOT_FOUND", message: "El recurso solicitado no existe." };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message = typeof response === "string" ? response : ((response as { message?: string }).message ?? exception.message);
      return { status, code: exception.name.replace(/Exception$/, "").toUpperCase() || "HTTP_ERROR", message };
    }

    const message = exception instanceof Error ? exception.message : "Error interno.";
    return { status: 500, code: "INTERNAL_ERROR", message };
  }
}
