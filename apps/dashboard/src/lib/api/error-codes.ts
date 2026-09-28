import type { components } from "./schema";

// Códigos de error del envelope { error: { code, message } } que el
// dashboard distingue (api-contract.md §1). Un solo lugar para que ninguna
// pantalla compare contra un string suelto. El `satisfies` contra el enum
// ErrorCode generado de openapi.json (API-10) hace fallar el build si la API
// renombra o quita un código que el dashboard usa.
export const API_ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOO_MANY_ATTEMPTS: "TOO_MANY_ATTEMPTS",
  LOGIN_BUSY: "LOGIN_BUSY",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  VOICE_NOT_CONFIGURED: "VOICE_NOT_CONFIGURED",
  NOT_FOUND: "NOT_FOUND",
} as const satisfies Record<string, components["schemas"]["ErrorCode"]>;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

// Código propio del cliente, no de la API: una respuesta de error sin el
// envelope (por ejemplo, un 500 del rewrite con la API caída). Queda fuera
// de API_ERROR_CODES porque no está en el enum ErrorCode de la API.
export const CLIENT_UNKNOWN_ERROR_CODE = "UNKNOWN_ERROR";
