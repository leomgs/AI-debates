import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import { Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ZodValidationException } from "nestjs-zod";
import { InvalidEpisodeTransitionError } from "../../modules/episodes/episodes.errors";
import { SequenceIndexOutOfRangeError } from "../../modules/tts/tts.errors";
import { ManifestNotReadyError } from "../../modules/render/render.errors";

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
    const { status, code, message } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(message, exception instanceof Error ? exception.stack : exception);
    }

    response.status(status).json({ error: { code, message } });
  }

  private resolve(exception: unknown): { status: number; code: string; message: string } {
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
