import { ConfigService } from "@nestjs/config";
import type { Env } from "../../shared/config/env.schema";
import { hashPassword } from "../../shared/crypto/scrypt-password";
import { AuthService } from "./auth.service";
import { InvalidCredentialsError, TooManyLoginAttemptsError } from "./auth.errors";
import { LOGIN_RATE_LIMIT, LoginRateLimiterService } from "./login-rate-limiter.service";
import { SessionService } from "./session.service";
import { checkSessionToken } from "./session-token";

const SECRET = "test-session-secret-0123456789abcdef";

function configWith(values: Partial<Env>): ConfigService<Env, true> {
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

describe("AuthService", () => {
  let passwordHash: string;
  let rateLimiter: LoginRateLimiterService;
  let service: AuthService;

  beforeAll(async () => {
    passwordHash = await hashPassword("contraseña-correcta");
  });

  beforeEach(() => {
    const config = configWith({
      CURATOR_USERNAME: "curador",
      CURATOR_PASSWORD_HASH: passwordHash,
      SESSION_SECRET: SECRET,
      NODE_ENV: "test",
    });
    rateLimiter = new LoginRateLimiterService();
    service = new AuthService(config, new SessionService(config), rateLimiter);
  });

  it("con credenciales correctas emite un token de sesión válido", async () => {
    const before = Date.now();
    const session = await service.login("curador", "contraseña-correcta", "ip-a");

    expect(checkSessionToken(SECRET, session.token, Date.now())).toEqual({ valid: true, expiresAt: session.expiresAt });
    expect(session.expiresAt).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
  });

  it.each([
    ["contraseña incorrecta", "curador", "otra-contraseña"],
    ["usuario incorrecto", "otro-usuario", "contraseña-correcta"],
    ["usuario de otro largo", "c", "contraseña-correcta"],
    ["ambos incorrectos", "otro-usuario", "otra-contraseña"],
  ])("rechaza con InvalidCredentialsError y el mismo mensaje: %s", async (_caso, username, password) => {
    const error = await service.login(username, password, "ip-a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidCredentialsError);
    expect((error as Error).message).toBe("Usuario o contraseña incorrectos.");
  });

  it("cuenta cada fallo en el rate-limit y, al llegar al máximo, rechaza incluso la credencial correcta", async () => {
    for (let i = 0; i < LOGIN_RATE_LIMIT.maxFailuresPerClient; i++) {
      await expect(service.login("curador", "mal", "ip-a")).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    await expect(service.login("curador", "contraseña-correcta", "ip-a")).rejects.toBeInstanceOf(TooManyLoginAttemptsError);
    // Otro cliente sigue pudiendo entrar.
    await expect(service.login("curador", "contraseña-correcta", "ip-b")).resolves.toHaveProperty("token");
  });

  it("un login exitoso limpia los fallos previos del cliente", async () => {
    const successSpy = jest.spyOn(rateLimiter, "recordSuccess");
    await expect(service.login("curador", "mal", "ip-a")).rejects.toBeInstanceOf(InvalidCredentialsError);
    await service.login("curador", "contraseña-correcta", "ip-a");
    expect(successSpy).toHaveBeenCalledWith("ip-a");
  });
});
