import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { loginErrorMessage } from "./login-error-message";

const apiError = (code: string, retryAfterSeconds: number | null = null, status = 401) =>
  new ApiError({ status, code, message: `mensaje de ${code}`, retryAfterSeconds });

describe("loginErrorMessage", () => {
  it("credencial incorrecta: no indica qué campo falló (AC 3.2)", () => {
    const message = loginErrorMessage(apiError("INVALID_CREDENTIALS"));
    expect(message).toBe("Usuario o contraseña incorrectos.");
  });

  it("rate-limit: mensaje específico, distinto del de credencial incorrecta (AC 3.8)", () => {
    const message = loginErrorMessage(apiError("TOO_MANY_ATTEMPTS", 840, 429));
    expect(message).toContain("Demasiados intentos, esperá unos minutos.");
    expect(message).toContain("14 min");
    expect(message).not.toBe(loginErrorMessage(apiError("INVALID_CREDENTIALS")));
  });

  it("rate-limit sin Retry-After", () => {
    expect(loginErrorMessage(apiError("TOO_MANY_ATTEMPTS", null, 429))).toBe("Demasiados intentos, esperá unos minutos.");
  });

  it("LOGIN_BUSY pide reintentar ya", () => {
    expect(loginErrorMessage(apiError("LOGIN_BUSY", 1, 429))).toContain("Reintentá en un momento");
  });

  it("otro error de la API muestra su mensaje", () => {
    expect(loginErrorMessage(apiError("INTERNAL_ERROR", null, 500))).toBe(
      "No se pudo iniciar sesión: mensaje de INTERNAL_ERROR",
    );
  });

  it("falla de red", () => {
    expect(loginErrorMessage(new TypeError("Failed to fetch"))).toContain("No se pudo conectar");
  });
});
