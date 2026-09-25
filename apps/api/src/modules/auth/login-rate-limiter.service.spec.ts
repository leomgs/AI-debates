import { TooManyLoginAttemptsError } from "./auth.errors";
import { LOGIN_RATE_LIMIT, LoginRateLimiterService } from "./login-rate-limiter.service";

const { windowMs, maxFailuresPerClient, maxFailuresGlobal } = LOGIN_RATE_LIMIT;
const T0 = 1_000_000_000_000;

function fail(limiter: LoginRateLimiterService, client: string, times: number, now = T0) {
  for (let i = 0; i < times; i++) limiter.recordFailure(client, now);
}

describe("LoginRateLimiterService", () => {
  let limiter: LoginRateLimiterService;

  beforeEach(() => {
    limiter = new LoginRateLimiterService();
  });

  it("permite intentos mientras el cliente no llega al máximo de fallos", () => {
    fail(limiter, "ip-a", maxFailuresPerClient - 1);
    expect(() => limiter.assertAllowed("ip-a", T0)).not.toThrow();
  });

  it("bloquea al cliente al llegar al máximo, con Retry-After hasta que sale el fallo más viejo", () => {
    fail(limiter, "ip-a", maxFailuresPerClient);

    let error: unknown;
    try {
      limiter.assertAllowed("ip-a", T0 + 60_000);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(TooManyLoginAttemptsError);
    expect((error as TooManyLoginAttemptsError).retryAfterSeconds).toBe((windowMs - 60_000) / 1000);
  });

  it("el bloqueo de un cliente no afecta a otro", () => {
    fail(limiter, "ip-a", maxFailuresPerClient);
    expect(() => limiter.assertAllowed("ip-b", T0)).not.toThrow();
  });

  it("la ventana es deslizante: pasado windowMs desde los fallos, vuelve a permitir", () => {
    fail(limiter, "ip-a", maxFailuresPerClient);
    expect(() => limiter.assertAllowed("ip-a", T0 + windowMs - 1)).toThrow(TooManyLoginAttemptsError);
    expect(() => limiter.assertAllowed("ip-a", T0 + windowMs)).not.toThrow();
  });

  it("un login exitoso limpia los fallos del cliente", () => {
    fail(limiter, "ip-a", maxFailuresPerClient - 1);
    limiter.recordSuccess("ip-a");
    fail(limiter, "ip-a", maxFailuresPerClient - 1);
    expect(() => limiter.assertAllowed("ip-a", T0)).not.toThrow();
  });

  it("techo global: rotar la clave de cliente no evita el bloqueo", () => {
    for (let i = 0; i < maxFailuresGlobal; i++) limiter.recordFailure(`ip-rotada-${i}`, T0);
    expect(() => limiter.assertAllowed("ip-nueva", T0)).toThrow(TooManyLoginAttemptsError);
    expect(() => limiter.assertAllowed("ip-nueva", T0 + windowMs)).not.toThrow();
  });

  it("un login exitoso no perdona los fallos globales", () => {
    for (let i = 0; i < maxFailuresGlobal; i++) limiter.recordFailure(`ip-rotada-${i}`, T0);
    limiter.recordSuccess("ip-rotada-0");
    expect(() => limiter.assertAllowed("ip-rotada-0", T0)).toThrow(TooManyLoginAttemptsError);
  });
});
