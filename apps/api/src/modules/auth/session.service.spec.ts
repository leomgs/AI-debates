import { ConfigService } from "@nestjs/config";
import type { Env } from "../../shared/config/env.schema";
import { SessionService } from "./session.service";
import { SESSION_COOKIE_NAME } from "./session-cookie";
import { SESSION_TTL_MS } from "./session-token";

const SECRET = "test-session-secret-0123456789abcdef";

function serviceFor(nodeEnv: Env["NODE_ENV"]): SessionService {
  const values: Partial<Env> = { SESSION_SECRET: SECRET, NODE_ENV: nodeEnv };
  return new SessionService({ get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>);
}

describe("SessionService", () => {
  it("valida la cookie de sesión que él mismo emitió, leída del header Cookie", () => {
    const sessions = serviceFor("development");
    const { token, expiresAt } = sessions.issue(1_000);
    expect(sessions.check(`otra=1; ${SESSION_COOKIE_NAME}=${token}`, 2_000)).toEqual({ valid: true, expiresAt });
  });

  it("sin cookie de sesión, o con una vencida, no hay sesión", () => {
    const sessions = serviceFor("development");
    const { token, expiresAt } = sessions.issue(1_000);
    expect(sessions.check(undefined)).toEqual({ valid: false });
    expect(sessions.check("otra=1")).toEqual({ valid: false });
    expect(sessions.check(`${SESSION_COOKIE_NAME}=${token}`, expiresAt)).toEqual({ valid: false });
  });

  it("la cookie es Secure solo en producción y dura lo mismo que el token", () => {
    expect(serviceFor("development").cookieOptionsForLogin()).toMatchObject({ secure: false, maxAge: SESSION_TTL_MS });
    expect(serviceFor("test").cookieOptionsForLogin().secure).toBe(false);
    expect(serviceFor("production").cookieOptionsForLogin()).toMatchObject({ secure: true, httpOnly: true, sameSite: "lax", path: "/" });
    expect(serviceFor("production").cookieOptionsForLogout()).toEqual({ secure: true, httpOnly: true, sameSite: "lax", path: "/" });
  });
});
