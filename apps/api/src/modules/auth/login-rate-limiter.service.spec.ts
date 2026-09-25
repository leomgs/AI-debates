import { TooManyLoginAttemptsError } from "./auth.errors";
import { LOGIN_RATE_LIMIT, LoginRateLimiterService } from "./login-rate-limiter.service";

const { windowMs, maxFailuresPerClient, maxFailuresGlobal, maxConcurrentVerifications } = LOGIN_RATE_LIMIT;
const T0 = 1_000_000_000_000;

// Intento fallido completo: empieza (queda contado) y libera la verificación.
function fail(limiter: LoginRateLimiterService, client: string, times: number, now = T0) {
  for (let i = 0; i < times; i++) {
    limiter.beginAttempt(client, now);
    limiter.release();
  }
}

function succeed(limiter: LoginRateLimiterService, client: string, now = T0) {
  const attempt = limiter.beginAttempt(client, now);
  limiter.recordSuccess(attempt);
  limiter.release();
}

function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

describe("LoginRateLimiterService", () => {
  let limiter: LoginRateLimiterService;

  beforeEach(() => {
    limiter = new LoginRateLimiterService();
  });

  it("permite intentos mientras el cliente no llega al máximo de fallos", () => {
    fail(limiter, "ip-a", maxFailuresPerClient - 1);
    expect(() => limiter.beginAttempt("ip-a", T0)).not.toThrow();
  });

  it("bloquea al cliente al llegar al máximo, con Retry-After hasta que sale el fallo más viejo", () => {
    fail(limiter, "ip-a", maxFailuresPerClient);

    const error = errorOf(() => limiter.beginAttempt("ip-a", T0 + 60_000));
    expect(error).toBeInstanceOf(TooManyLoginAttemptsError);
    expect((error as TooManyLoginAttemptsError).retryAfterSeconds).toBe((windowMs - 60_000) / 1000);
  });

  it("un intento en curso ya cuenta como fallo (sin esperar a que termine la verificación)", () => {
    fail(limiter, "ip-a", maxFailuresPerClient - 1);
    // Sin release(): el quinto intento sigue verificando, pero ya ocupa cupo.
    limiter.beginAttempt("ip-a", T0);

    const error = errorOf(() => limiter.beginAttempt("ip-a", T0));
    expect(error).toBeInstanceOf(TooManyLoginAttemptsError);
    // Bloqueo por ventana (Retry-After largo), no por el tope de concurrencia.
    expect((error as TooManyLoginAttemptsError).retryAfterSeconds).toBe(windowMs / 1000);
  });

  it("el bloqueo de un cliente no afecta a otro", () => {
    fail(limiter, "ip-a", maxFailuresPerClient);
    expect(() => limiter.beginAttempt("ip-b", T0)).not.toThrow();
  });

  it("la ventana es deslizante: pasado windowMs desde los fallos, vuelve a permitir", () => {
    fail(limiter, "ip-a", maxFailuresPerClient);
    expect(() => limiter.beginAttempt("ip-a", T0 + windowMs - 1)).toThrow(TooManyLoginAttemptsError);
    expect(() => limiter.beginAttempt("ip-a", T0 + windowMs)).not.toThrow();
  });

  it("4 fallos, 1 acierto y 4 fallos más no bloquean al cliente", () => {
    fail(limiter, "ip-a", maxFailuresPerClient - 1);
    succeed(limiter, "ip-a");
    fail(limiter, "ip-a", maxFailuresPerClient - 1);
    expect(() => limiter.beginAttempt("ip-a", T0)).not.toThrow();
  });

  it("un acierto saca de la cubeta global solo su propio intento", () => {
    for (let i = 0; i < maxFailuresGlobal - 1; i++) fail(limiter, `ip-rotada-${i}`, 1);
    // El acierto no ocupa lugar en la global: después todavía entra un intento más.
    succeed(limiter, "curador");
    expect(() => {
      limiter.beginAttempt("otra", T0);
      limiter.release();
    }).not.toThrow();
    // ...y con eso la global queda llena: los fallos de otros no se perdonaron.
    expect(() => limiter.beginAttempt("curador", T0)).toThrow(TooManyLoginAttemptsError);
  });

  it("techo global: rotar la clave de cliente no evita el bloqueo", () => {
    for (let i = 0; i < maxFailuresGlobal; i++) fail(limiter, `ip-rotada-${i}`, 1);
    expect(() => limiter.beginAttempt("ip-nueva", T0)).toThrow(TooManyLoginAttemptsError);
    expect(() => limiter.beginAttempt("ip-nueva", T0 + windowMs)).not.toThrow();
  });

  it("tope de verificaciones en curso: sin release(), el siguiente intento es 429 con Retry-After corto", () => {
    for (let i = 0; i < maxConcurrentVerifications; i++) limiter.beginAttempt(`ip-${i}`, T0);

    const error = errorOf(() => limiter.beginAttempt("ip-otra", T0));
    expect(error).toBeInstanceOf(TooManyLoginAttemptsError);
    expect((error as TooManyLoginAttemptsError).retryAfterSeconds).toBe(1);

    limiter.release();
    expect(() => limiter.beginAttempt("ip-otra", T0)).not.toThrow();
  });

  it("un intento rechazado por el tope de concurrencia no se cuenta como fallo", () => {
    for (let i = 0; i < maxConcurrentVerifications; i++) limiter.beginAttempt(`ocupa-${i}`, T0);
    for (let i = 0; i < 10; i++) expect(() => limiter.beginAttempt("ip-a", T0)).toThrow(TooManyLoginAttemptsError);
    for (let i = 0; i < maxConcurrentVerifications; i++) limiter.release();

    fail(limiter, "ip-a", maxFailuresPerClient - 1);
    expect(() => limiter.beginAttempt("ip-a", T0)).not.toThrow();
  });
});
