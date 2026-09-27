// Códigos de error del envelope { error: { code, message } } que el
// dashboard distingue (api-contract.md §1). Un solo lugar para que ninguna
// pantalla compare contra un string suelto.
//
// API-10: tipar con satisfies Record<string, components["schemas"]["ErrorCode"]>
// cuando el enum ErrorCode esté en openapi.json (hoy `code` es un string libre).
export const API_ERROR_CODES = {
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  TOO_MANY_ATTEMPTS: "TOO_MANY_ATTEMPTS",
  LOGIN_BUSY: "LOGIN_BUSY",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  VOICE_NOT_CONFIGURED: "VOICE_NOT_CONFIGURED",
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

// Código propio del cliente, no de la API: una respuesta de error sin el
// envelope (por ejemplo, un 500 del rewrite con la API caída). Queda fuera
// de API_ERROR_CODES para que el `satisfies` de API-10 no lo exija en el enum.
export const CLIENT_UNKNOWN_ERROR_CODE = "UNKNOWN_ERROR";
