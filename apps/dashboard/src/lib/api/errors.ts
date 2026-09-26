import type { components } from "./schema";

type ErrorResponse = components["schemas"]["ErrorResponseDto"];

// Error de la API con el envelope { error: { code, message } }
// (api-contract.md §1). Las pantallas eligen el mensaje por `code`, nunca
// por el texto.
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Segundos de `Retry-After`, si la respuesta lo trae (429 del login). */
  readonly retryAfterSeconds: number | null;

  constructor(params: { status: number; code: string; message: string; retryAfterSeconds?: number | null }) {
    super(params.message);
    this.name = "ApiError";
    this.status = params.status;
    this.code = params.code;
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
  }
}

function isErrorResponse(body: unknown): body is ErrorResponse {
  if (typeof body !== "object" || body === null || !("error" in body)) return false;
  const error = (body as { error: unknown }).error;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

// Una respuesta sin el envelope (por ejemplo, un 500 del rewrite de Next con
// la API caída) igual se convierte en ApiError, con un código genérico.
export function toApiError(body: unknown, response: Response): ApiError {
  const retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"));
  if (isErrorResponse(body)) {
    return new ApiError({
      status: response.status,
      code: body.error.code,
      message: body.error.message,
      retryAfterSeconds,
    });
  }
  return new ApiError({
    status: response.status,
    code: "UNKNOWN_ERROR",
    message: `El servidor respondió con un error (HTTP ${response.status}).`,
    retryAfterSeconds,
  });
}

type FetchResult<T> = { data?: T; error?: unknown; response: Response };

// Convierte el resultado de openapi-fetch en datos o en una excepción, para
// que TanStack Query vea los errores (y el manejo global del 401 funcione).
export function unwrap<T>(result: FetchResult<T>): T {
  if (!result.response.ok) throw toApiError(result.error, result.response);
  return result.data as T;
}

// Sesión ausente, alterada o vencida (AC 3.5, 3.7). El 401 del login es
// INVALID_CREDENTIALS y no cuenta: ese lo maneja el formulario (AC 3.2).
export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === "UNAUTHORIZED";
}
