// Errores tipados del login (coding-rules.md §5). HttpErrorFilter los mapea
// al envelope { error: { code, message } }:
// - InvalidCredentialsError -> 401 INVALID_CREDENTIALS. Mismo mensaje para
//   usuario o contraseña incorrectos (AC 3.2: no se indica cuál falló).
// - TooManyLoginAttemptsError -> 429 TOO_MANY_ATTEMPTS + Retry-After, para
//   que el formulario muestre un mensaje distinto (AC 3.8).
// - LoginBusyError -> 429 LOGIN_BUSY + Retry-After: 1. No es un bloqueo: ya
//   hay verificaciones de contraseña en curso y alcanza con reintentar en un
//   segundo. Code propio (y no TOO_MANY_ATTEMPTS) para que el dashboard elija
//   el mensaje por el code, como con el resto de los errores, sin tener que
//   interpretar Retry-After para distinguir "esperá minutos" de "reintentá ya".
// La falta de sesión en cualquier otro endpoint no pasa por acá: el
// SessionGuard lanza UnauthorizedException -> 401 UNAUTHORIZED.

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Usuario o contraseña incorrectos.");
    this.name = "InvalidCredentialsError";
  }
}

export class LoginBusyError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Hay otro intento de inicio de sesión en curso. Reintentá en un momento.");
    this.name = "LoginBusyError";
  }
}

export class TooManyLoginAttemptsError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Demasiados intentos de inicio de sesión. Esperá unos minutos y volvé a intentar.");
    this.name = "TooManyLoginAttemptsError";
  }
}
