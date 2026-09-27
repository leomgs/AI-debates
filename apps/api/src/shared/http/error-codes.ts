import { z } from "zod";

// API-10 (spec 003): única fuente de los `code` del envelope de error
// (api-contract.md §1). HttpErrorFilter tipa lo que emite contra ErrorCode,
// así que un código nuevo que no esté acá no compila; ErrorResponseSchema
// (error-response.dto.ts) usa este mismo enum, así que openapi.json lo
// documenta sin poder divergir del filtro. `.meta({ id })` para que el
// OpenAPI lo nombre ErrorCode en vez de repetir el enum inline (mismo
// criterio que DebateLanguage).
//
// Los que coinciden con CheckpointReason (USAGE_LIMIT_EXCEEDED,
// PROVIDER_QUOTA_EXCEEDED, VOICE_NOT_CONFIGURED) usan el mismo literal a
// propósito (api-contract.md §1), pero son listas distintas: no todo motivo
// de checkpoint es un error HTTP ni al revés.
export const ErrorCodeSchema = z
  .enum([
    // 400
    "VALIDATION_ERROR",
    "INVALID_SEQUENCE_INDEX",
    // 401
    "UNAUTHORIZED",
    "INVALID_CREDENTIALS",
    // 403: URL de /audio-files vencida o alterada (configure-app.ts) o una
    // ForbiddenException de Nest.
    "FORBIDDEN",
    // 404
    "NOT_FOUND",
    // 409
    "INVALID_STATE_TRANSITION",
    "MANIFEST_NOT_READY",
    "VOICE_NOT_CONFIGURED",
    "USAGE_LIMIT_EXCEEDED",
    // 429
    "TOO_MANY_ATTEMPTS",
    "LOGIN_BUSY",
    // 503
    "PROVIDER_QUOTA_EXCEEDED",
    // Cualquier otra HttpException de Nest (405, 413, ...): conserva su
    // status HTTP, con un code genérico.
    "HTTP_ERROR",
    // 500
    "INTERNAL_ERROR",
  ])
  .meta({ id: "ErrorCode" });

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
