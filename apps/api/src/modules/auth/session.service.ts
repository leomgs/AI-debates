import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CookieOptions } from "express";
import type { Env } from "../../shared/config/env.schema";
import { SESSION_COOKIE_NAME, readCookie, sessionCookieOptions } from "./session-cookie";
import { SESSION_TTL_MS, checkSessionToken, issueSessionToken, type SessionTokenCheck } from "./session-token";

// Emisión y validación de la sesión del curador (ADR 0001 punto 1): la usan
// AuthService (login), AuthController (session/logout) y el SessionGuard
// global. Envuelve las funciones puras de session-token/session-cookie con
// el secreto y el entorno de ConfigService.
@Injectable()
export class SessionService {
  private readonly secret: string;
  private readonly secureCookie: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.secret = config.get("SESSION_SECRET", { infer: true });
    this.secureCookie = config.get("NODE_ENV", { infer: true }) === "production";
  }

  issue(now: number = Date.now()): { token: string; expiresAt: number } {
    return issueSessionToken(this.secret, now);
  }

  // Recibe el header Cookie crudo (req.headers.cookie).
  check(cookieHeader: string | undefined, now: number = Date.now()): SessionTokenCheck {
    const token = readCookie(cookieHeader, SESSION_COOKIE_NAME);
    if (!token) return { valid: false };
    return checkSessionToken(this.secret, token, now);
  }

  // maxAge igual a la vigencia del token: el navegador descarta la cookie
  // en el mismo momento en que la firma deja de valer.
  cookieOptionsForLogin(): CookieOptions {
    return { ...sessionCookieOptions(this.secureCookie), maxAge: SESSION_TTL_MS };
  }

  // res.clearCookie necesita los mismos atributos (Path, Secure, SameSite)
  // para que el navegador reconozca la cookie a borrar.
  cookieOptionsForLogout(): CookieOptions {
    return sessionCookieOptions(this.secureCookie);
  }
}
