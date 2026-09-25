import type { ArgumentsHost } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { InvalidCredentialsError, LoginBusyError, TooManyLoginAttemptsError } from "../../modules/auth/auth.errors";
import { HttpErrorFilter } from "./http-error.filter";

function run(exception: unknown) {
  const response = { status: jest.fn(), json: jest.fn(), setHeader: jest.fn() };
  response.status.mockReturnValue(response);
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  new HttpErrorFilter().catch(exception, host);
  return response;
}

describe("HttpErrorFilter — errores de auth (API-8)", () => {
  it("sin sesión: 401 UNAUTHORIZED", () => {
    const res = run(new UnauthorizedException("x"));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "UNAUTHORIZED", message: "x" } });
  });

  it("credencial incorrecta: 401 INVALID_CREDENTIALS, sin Retry-After", () => {
    const res = run(new InvalidCredentialsError());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "INVALID_CREDENTIALS", message: expect.any(String) } });
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it("bloqueo por ventana: 429 TOO_MANY_ATTEMPTS con Retry-After", () => {
    const res = run(new TooManyLoginAttemptsError(840));
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "840");
    expect(res.json).toHaveBeenCalledWith({ error: { code: "TOO_MANY_ATTEMPTS", message: expect.stringMatching(/minutos/) } });
  });

  it("verificaciones en curso: 429 LOGIN_BUSY con Retry-After 1 y un mensaje distinto", () => {
    const res = run(new LoginBusyError(1));
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "1");
    expect(res.json).toHaveBeenCalledWith({ error: { code: "LOGIN_BUSY", message: expect.stringMatching(/en curso/) } });
  });
});
