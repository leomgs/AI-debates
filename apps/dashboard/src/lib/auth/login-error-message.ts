import { ApiError } from "@/lib/api/errors";

// Mensajes del formulario de login, elegidos por `code` (api-contract.md §1.1).
export function loginErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "No se pudo conectar con el servidor. Revisá tu conexión y reintentá.";
  }
  switch (error.code) {
    // AC 3.2: sin indicar cuál de los dos campos falló.
    case "INVALID_CREDENTIALS":
      return "Usuario o contraseña incorrectos.";
    // AC 3.8: distinto del de credencial incorrecta.
    case "TOO_MANY_ATTEMPTS": {
      const minutes = error.retryAfterSeconds !== null ? Math.ceil(error.retryAfterSeconds / 60) : null;
      const wait = minutes !== null && minutes > 0 ? ` Vas a poder reintentar en unos ${minutes} min.` : "";
      return `Demasiados intentos, esperá unos minutos.${wait}`;
    }
    case "LOGIN_BUSY":
      return "Hay otro intento de inicio de sesión en curso. Reintentá en un momento.";
    case "VALIDATION_ERROR":
      return "Completá el usuario y la contraseña.";
    default:
      return `No se pudo iniciar sesión: ${error.message}`;
  }
}
