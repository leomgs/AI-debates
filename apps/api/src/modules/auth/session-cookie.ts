import type { CookieOptions } from "express";

// Cookie de sesión del curador (ADR 0001 punto 2). El nombre es parte del
// contrato con el dashboard: src/proxy.ts de Next solo mira si existe para
// el chequeo optimista de /studio/* (la validación real es la de Nest).
export const SESSION_COOKIE_NAME = "atd_session";

// httpOnly (el JS del navegador no la lee), SameSite=Lax, Path=/ y sin
// Domain (queda atada al host exacto que la emitió: el origen de Next, ADR
// 0001 punto 3). Secure solo en producción: en local el dashboard corre
// sobre http y el navegador descartaría una cookie Secure.
export function sessionCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: "lax", path: "/", secure };
}

// Lectura del header Cookie a mano, sin cookie-parser (una sola cookie que
// leer no justifica un middleware global). Formato RFC 6265:
// "a=1; b=2". Si el nombre aparece repetido gana la primera aparición, que es
// la de Path más específico según el orden que manda el navegador.
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;

    let value = pair.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value; // secuencia % inválida: se devuelve tal cual y la firma la rechaza
    }
  }
  return undefined;
}
