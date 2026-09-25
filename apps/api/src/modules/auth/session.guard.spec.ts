import { Controller, ExecutionContext, Get, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../shared/config/env.schema";
import { Public } from "../../shared/http/public.decorator";
import { SessionGuard } from "./session.guard";
import { SessionService } from "./session.service";
import { SESSION_COOKIE_NAME } from "./session-cookie";

const SECRET = "test-session-secret-0123456789abcdef";

// Controllers de juguete: la metadata real de @Public() es lo que se prueba.
@Controller("protegido")
class ProtectedController {
  @Get()
  handler() {}

  @Public()
  @Get("abierto")
  publicHandler() {}
}

@Public()
@Controller("abierto-entero")
class PublicController {
  @Get()
  handler() {}
}

function httpContext(
  controller: new () => object,
  handlerName: string,
  cookie?: string,
  type: "http" | "rpc" = "http"
): ExecutionContext {
  const handler = (controller.prototype as Record<string, () => void>)[handlerName];
  return {
    getType: () => type,
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ headers: cookie ? { cookie } : {} }) }),
  } as unknown as ExecutionContext;
}

describe("SessionGuard", () => {
  const values: Partial<Env> = { SESSION_SECRET: SECRET, NODE_ENV: "test" };
  const sessions = new SessionService({ get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>);
  const guard = new SessionGuard(new Reflector(), sessions);

  it("niega por defecto: un handler sin @Public() y sin cookie da 401", () => {
    expect(() => guard.canActivate(httpContext(ProtectedController, "handler"))).toThrow(UnauthorizedException);
  });

  it("niega una cookie alterada o de otro secreto", () => {
    const { token } = sessions.issue();
    const tampered = token.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    expect(() => guard.canActivate(httpContext(ProtectedController, "handler", `${SESSION_COOKIE_NAME}=${tampered}`))).toThrow(
      UnauthorizedException
    );
  });

  it("deja pasar un handler protegido con una cookie de sesión válida", () => {
    const { token } = sessions.issue();
    expect(guard.canActivate(httpContext(ProtectedController, "handler", `${SESSION_COOKIE_NAME}=${token}`))).toBe(true);
  });

  it("deja pasar sin cookie un handler marcado con @Public()", () => {
    expect(guard.canActivate(httpContext(ProtectedController, "publicHandler"))).toBe(true);
  });

  it("deja pasar sin cookie los handlers de un controller marcado entero con @Public()", () => {
    expect(guard.canActivate(httpContext(PublicController, "handler"))).toBe(true);
  });

  it("niega contextos que no son HTTP", () => {
    const { token } = sessions.issue();
    expect(guard.canActivate(httpContext(ProtectedController, "handler", `${SESSION_COOKIE_NAME}=${token}`, "rpc"))).toBe(false);
  });
});
