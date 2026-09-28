import type { ArgumentsHost } from "@nestjs/common";
import * as nestCommon from "@nestjs/common";
import { HttpException, UnauthorizedException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { z, ZodError } from "zod";
import { ZodValidationException } from "nestjs-zod";
import { InvalidCredentialsError, LoginBusyError, TooManyLoginAttemptsError } from "../../modules/auth/auth.errors";
import { BudgetExceededError, InvalidEpisodeTransitionError } from "../../modules/episodes/episodes.errors";
import { DailyQuotaExceededError, RateLimitWaitExceededError } from "../../modules/ai/ai.errors";
import { SequenceIndexOutOfRangeError, TtsProviderUnavailableError, VoiceNotConfiguredError } from "../../modules/tts/tts.errors";
import { ManifestNotReadyError } from "../../modules/render/render.errors";
import { BrokenCircuitError } from "cockatiel";
import { HttpErrorFilter } from "./http-error.filter";
import { ErrorCodeSchema } from "./error-codes";

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

describe("HttpErrorFilter — voces (spec 004, D15)", () => {
  it("VoiceNotConfiguredError: 409 VOICE_NOT_CONFIGURED con idioma, proveedor y agentes en el mensaje", () => {
    const error = new VoiceNotConfiguredError("EN", "LOCAL", ["Analista (ANALYST)", "rol JUDGE (sin fila Agent)"]);
    const res = run(error);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: { code: "VOICE_NOT_CONFIGURED", message: error.message } });
    expect(error.message).toMatch(/idioma EN/);
    expect(error.message).toMatch(/"LOCAL"/);
    expect(error.message).toMatch(/Analista \(ANALYST\), rol JUDGE \(sin fila Agent\)/);
  });
});

// El dashboard infiere el campo del form por el prefijo `<path>: ` del
// mensaje (formatZodIssue): se fija acá el formato del primer issue.
describe("HttpErrorFilter — mensaje de los errores de Zod", () => {
  it("ZodValidationException del pipe global: 400 VALIDATION_ERROR con `<campo>: <mensaje>` del primer issue", () => {
    const result = z.object({ topic: z.string().max(300) }).safeParse({ topic: "x".repeat(301) });
    if (result.success) throw new Error("el schema debería rechazar el topic");
    const res = run(new ZodValidationException(result.error));
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0] as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe(`topic: ${result.error.issues[0].message}`);
  });

  it("paths anidados se unen con punto", () => {
    const result = z.object({ limits: z.object({ maxLlmCalls: z.number() }) }).safeParse({ limits: { maxLlmCalls: "x" } });
    if (result.success) throw new Error("el schema debería rechazar maxLlmCalls");
    const body = run(result.error).json.mock.calls[0][0] as { error: { message: string } };
    expect(body.error.message).toMatch(/^limits\.maxLlmCalls: /);
  });
});

// API-10: el enum ErrorCode (error-codes.ts) es lo que documenta openapi.json
// y lo que tipa el dashboard. `resolve` ya está tipado con ErrorCode, así que
// un code nuevo fuera del enum no compila; esto cubre lo que el tipo no ve:
// que cada rama del filtro, y cualquier HttpException de Nest, termine en un
// code del enum en runtime, y que el enum no documente codes que nadie emite.
describe("HttpErrorFilter — codes documentados en openapi.json (API-10)", () => {
  // Todas las HttpException que exporta @nestjs/common (NotFoundException,
  // PayloadTooLargeException, ...): pueden llegar del código o de Nest (una
  // ruta inexistente es NotFoundException).
  const nestHttpExceptions = (Object.values(nestCommon) as unknown[])
    .filter(
      (value): value is new () => HttpException =>
        typeof value === "function" && value !== HttpException && value.prototype instanceof HttpException
    )
    .map((Exception) => new Exception());

  // Una excepción por rama del filtro, en el mismo orden.
  const branchExceptions: unknown[] = [
    new InvalidEpisodeTransitionError("APPROVED", "approve"),
    new SequenceIndexOutOfRangeError("ep", 9, 3),
    new ManifestNotReadyError("ep"),
    new VoiceNotConfiguredError("EN", "LOCAL", ["Analista (ANALYST)"]),
    new BudgetExceededError("USAGE_LIMIT_EXCEEDED", "llmCalls", 25),
    new DailyQuotaExceededError("GOOGLE", 500),
    new RateLimitWaitExceededError("GOOGLE", 120_000, 90_000),
    new TtsProviderUnavailableError("LOCAL"),
    new BrokenCircuitError(),
    new InvalidCredentialsError(),
    new LoginBusyError(1),
    new TooManyLoginAttemptsError(840),
    new ZodError([]),
    new ZodValidationException(new ZodError([])),
    new Prisma.PrismaClientKnownRequestError("no existe", { code: "P2025", clientVersion: "test" }),
    new HttpException("teapot", 418),
    new Error("cualquier otro"),
    "ni siquiera un Error",
  ];

  const emitted = [...branchExceptions, ...nestHttpExceptions].map((exception) => {
    const body = run(exception).json.mock.calls[0][0] as { error: { code: string } };
    return body.error.code;
  });

  it("cubre las HttpException de Nest (sanity check del filtro de exports)", () => {
    expect(nestHttpExceptions.length).toBeGreaterThan(15);
  });

  it("todo code que emite el filtro está en el enum ErrorCode", () => {
    const documented = new Set<string>(ErrorCodeSchema.options);
    expect(emitted.filter((code) => !documented.has(code))).toEqual([]);
  });

  it("el enum no documenta codes que el filtro no emite", () => {
    expect([...new Set(emitted)].sort()).toEqual([...ErrorCodeSchema.options].sort());
  });

  it("las HttpException genéricas salen con un code fijo por status, no con el nombre de la clase", () => {
    const codeOf = (exception: unknown) => (run(exception).json.mock.calls[0][0] as { error: { code: string } }).error.code;
    expect(codeOf(new nestCommon.BadRequestException("status inválido"))).toBe("VALIDATION_ERROR");
    expect(codeOf(new nestCommon.NotFoundException("Cannot POST /x"))).toBe("NOT_FOUND");
    expect(codeOf(new nestCommon.ForbiddenException())).toBe("FORBIDDEN");
    expect(codeOf(new nestCommon.PayloadTooLargeException())).toBe("HTTP_ERROR");
    expect(run(new nestCommon.PayloadTooLargeException()).status).toHaveBeenCalledWith(413);
  });
});
