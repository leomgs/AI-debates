import { ConfigService } from "@nestjs/config";
import type { Env } from "../../shared/config/env.schema";
import { hashPassword } from "../../shared/crypto/scrypt-password";
import { AuthService } from "./auth.service";
import { InvalidCredentialsError, LoginBusyError, TooManyLoginAttemptsError } from "./auth.errors";
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

  it("los aciertos no gastan cupo, pero no perdonan fallos: 4 fallos, 2 aciertos, el 5.º fallo, y después 429", async () => {
    const almostFull = LOGIN_RATE_LIMIT.maxFailuresPerClient - 1;
    for (let i = 0; i < almostFull; i++) {
      await expect(service.login("curador", "mal", "ip-a")).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    await expect(service.login("curador", "contraseña-correcta", "ip-a")).resolves.toHaveProperty("token");
    await expect(service.login("curador", "contraseña-correcta", "ip-a")).resolves.toHaveProperty("token");
    await expect(service.login("curador", "mal", "ip-a")).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(service.login("curador", "contraseña-correcta", "ip-a")).rejects.toBeInstanceOf(TooManyLoginAttemptsError);
  });

  it("ataque con la clave compartida: un acierto concurrente del curador no perdona los fallos del atacante", async () => {
    // Detrás del rewrite de Next, curador y atacante pueden compartir req.ip.
    for (let i = 0; i < 3; i++) {
      await expect(service.login("curador", `mal-${i}`, "ip-next")).rejects.toBeInstanceOf(InvalidCredentialsError);
    }
    // Atacante y curador verifican a la vez (el tope de concurrencia admite 2).
    const [attacker, curator] = await Promise.allSettled([
      service.login("curador", "mal-concurrente", "ip-next"),
      service.login("curador", "contraseña-correcta", "ip-next"),
    ]);
    expect(attacker.status === "rejected" && attacker.reason instanceof InvalidCredentialsError).toBe(true);
    expect(curator.status).toBe("fulfilled");

    // 4 fallos siguen contando: entra uno más y el siguiente ya es 429. Si el
    // acierto hubiera borrado la cubeta, el atacante tendría 5 intentos nuevos.
    await expect(service.login("curador", "mal-4", "ip-next")).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(service.login("curador", "mal-5", "ip-next")).rejects.toBeInstanceOf(TooManyLoginAttemptsError);
  });

  it("50 logins incorrectos concurrentes: a lo sumo 5 llegan a verificarse (401), el resto se rechaza (429)", async () => {
    const results = await Promise.allSettled(Array.from({ length: 50 }, (_, i) => service.login("curador", `mal-${i}`, "ip-a")));
    const reasons = results.map((r) => (r.status === "rejected" ? r.reason : r.value));

    const invalid = reasons.filter((r) => r instanceof InvalidCredentialsError).length;
    const rejected = reasons.filter((r) => r instanceof TooManyLoginAttemptsError || r instanceof LoginBusyError).length;
    expect(invalid).toBeGreaterThan(0);
    expect(invalid).toBeLessThanOrEqual(LOGIN_RATE_LIMIT.maxFailuresPerClient);
    expect(invalid + rejected).toBe(50);
  });

  it("libera el lugar de verificación aunque verifyPassword lance", async () => {
    const release = jest.spyOn(rateLimiter, "release");
    const broken = new AuthService(
      configWith({ CURATOR_USERNAME: "curador", CURATOR_PASSWORD_HASH: "hash-roto", SESSION_SECRET: SECRET, NODE_ENV: "test" }),
      new SessionService(configWith({ SESSION_SECRET: SECRET, NODE_ENV: "test" })),
      rateLimiter
    );
    await expect(broken.login("curador", "x", "ip-a")).rejects.toThrow(/formato/);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
