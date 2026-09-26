import type { ArgumentsHost } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
import { InvalidCredentialsError, LoginBusyError, TooManyLoginAttemptsError } from "../../modules/auth/auth.errors";
import { BudgetExceededError } from "../../modules/episodes/episodes.errors";
import { DailyQuotaExceededError, RateLimitWaitExceededError } from "../../modules/ai/ai.errors";
import { TtsProviderUnavailableError } from "../../modules/tts/tts.errors";
import { BrokenCircuitError } from "cockatiel";
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

describe("HttpErrorFilter — errores de proveedor y presupuesto (API-10b)", () => {
  it("presupuesto del episodio agotado: 409 USAGE_LIMIT_EXCEEDED", () => {
    const res = run(new BudgetExceededError("USAGE_LIMIT_EXCEEDED", "llmCalls", 25));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: "USAGE_LIMIT_EXCEEDED", message: "Se alcanzó el límite de llmCalls (25) configurado para este episodio." },
    });
  });

  it.each([
    ["cuota diaria del LLM", new DailyQuotaExceededError("GOOGLE", 500)],
    ["espera del rate limiter por encima del tope", new RateLimitWaitExceededError("GOOGLE", 120_000, 90_000)],
    ["TTS no disponible", new TtsProviderUnavailableError("LOCAL", new Error("boom"))],
  ])("%s: 503 PROVIDER_QUOTA_EXCEEDED", (_label, error) => {
    const res = run(error);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "PROVIDER_QUOTA_EXCEEDED", message: error.message } });
  });

  // Review F2-2: circuito abierto de Cockatiel → 503 con mensaje propio en
  // castellano, no el de la librería.
  it("circuit breaker abierto: 503 PROVIDER_QUOTA_EXCEEDED con mensaje en castellano", () => {
    const error = new BrokenCircuitError();
    const res = run(error);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: "PROVIDER_QUOTA_EXCEEDED", message: expect.stringMatching(/Reintentá más tarde/) },
    });
    expect(res.json.mock.calls[0][0].error.message).not.toBe(error.message);
  });

  it("cualquier otro error sigue siendo 500 INTERNAL_ERROR", () => {
    const res = run(new Error("el juez devolvió algo inválido"));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "INTERNAL_ERROR", message: "el juez devolvió algo inválido" } });
  });
});
