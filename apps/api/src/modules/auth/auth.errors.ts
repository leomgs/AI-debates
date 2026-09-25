// Errores tipados del login (coding-rules.md §5). HttpErrorFilter los mapea
// al envelope { error: { code, message } }:
// - InvalidCredentialsError -> 401 INVALID_CREDENTIALS. Mismo mensaje para
//   usuario o contraseña incorrectos (AC 3.2: no se indica cuál falló).
// - TooManyLoginAttemptsError -> 429 TOO_MANY_ATTEMPTS + Retry-After, para
//   que el formulario muestre un mensaje distinto (AC 3.8).
// La falta de sesión en cualquier otro endpoint no pasa por acá: el
// SessionGuard lanza UnauthorizedException -> 401 UNAUTHORIZED.

export class InvalidCredentialsError extends Error {
  constructor() {
    super("Usuario o contraseña incorrectos.");
    this.name = "InvalidCredentialsError";
  }
}

export class TooManyLoginAttemptsError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Demasiados intentos de inicio de sesión. Esperá unos minutos y volvé a intentar.");
    this.name = "TooManyLoginAttemptsError";
  }
}
