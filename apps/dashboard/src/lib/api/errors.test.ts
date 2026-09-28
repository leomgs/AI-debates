import { describe, expect, it } from "vitest";
import { ApiError, isNotFoundError, isUnauthorizedError, toApiError, unwrap } from "./errors";

describe("isNotFoundError (AC 3.41)", () => {
  it("es verdadero solo para 404 con el código NOT_FOUND del envelope", () => {
    expect(isNotFoundError(new ApiError({ status: 404, code: "NOT_FOUND", message: "" }))).toBe(true);
  });

  it("un 404 sin el envelope (código del cliente) u otro error no cuenta", () => {
    expect(isNotFoundError(new ApiError({ status: 404, code: "UNKNOWN_ERROR", message: "" }))).toBe(false);
    expect(isNotFoundError(new ApiError({ status: 401, code: "UNAUTHORIZED", message: "" }))).toBe(false);
    expect(isNotFoundError(new Error("red caída"))).toBe(false);
  });
});

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe("toApiError", () => {
  it("lee el envelope { error: { code, message } }", () => {
    const error = toApiError({ error: { code: "INVALID_CREDENTIALS", message: "Credenciales inválidas" } }, response(401));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.code).toBe("INVALID_CREDENTIALS");
    expect(error.message).toBe("Credenciales inválidas");
    expect(error.retryAfterSeconds).toBeNull();
  });

  it("toma Retry-After del 429", () => {
    const error = toApiError(
      { error: { code: "TOO_MANY_ATTEMPTS", message: "..." } },
      response(429, { "Retry-After": "840" }),
    );
    expect(error.retryAfterSeconds).toBe(840);
  });

  it("convierte una respuesta sin envelope en un error genérico", () => {
    const error = toApiError("Internal Server Error", response(500));
    expect(error.code).toBe("UNKNOWN_ERROR");
    expect(error.status).toBe(500);
    expect(error.message).toContain("500");
  });
});

describe("unwrap", () => {
  it("devuelve los datos si la respuesta es exitosa", () => {
    expect(unwrap({ data: { ok: 1 }, response: response(200) })).toEqual({ ok: 1 });
  });

  it("acepta un 204 sin body", () => {
    expect(unwrap({ response: response(204) })).toBeUndefined();
  });

  it("lanza ApiError si la respuesta falla", () => {
    expect(() =>
      unwrap({ error: { error: { code: "UNAUTHORIZED", message: "Sin sesión" } }, response: response(401) }),
    ).toThrow(ApiError);
  });
});

describe("isUnauthorizedError", () => {
  it("es verdadero solo para 401 UNAUTHORIZED (sesión ausente o vencida)", () => {
    expect(isUnauthorizedError(new ApiError({ status: 401, code: "UNAUTHORIZED", message: "" }))).toBe(true);
  });

  it("no confunde el 401 del login con una sesión vencida (AC 3.2 vs AC 3.7)", () => {
    expect(isUnauthorizedError(new ApiError({ status: 401, code: "INVALID_CREDENTIALS", message: "" }))).toBe(false);
  });

  it("ignora otros errores", () => {
    expect(isUnauthorizedError(new ApiError({ status: 409, code: "INVALID_STATE_TRANSITION", message: "" }))).toBe(false);
    expect(isUnauthorizedError(new Error("red caída"))).toBe(false);
  });
});
