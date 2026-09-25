import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Env } from "../../shared/config/env.schema";
import { verifyPassword } from "../../shared/crypto/scrypt-password";
import { InvalidCredentialsError } from "./auth.errors";
import { LoginRateLimiterService } from "./login-rate-limiter.service";
import { SessionService } from "./session.service";

// Login del único curador (ADR 0001, spec 003 API-8). Módulo de aplicación
// sin tablas propias: la credencial vive en el .env (CURATOR_USERNAME +
// CURATOR_PASSWORD_HASH) y la sesión es un token firmado sin estado.
@Injectable()
export class AuthService {
  private readonly username: string;
  private readonly passwordHash: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly sessions: SessionService,
    private readonly rateLimiter: LoginRateLimiterService
  ) {
    this.username = config.get("CURATOR_USERNAME", { infer: true });
    this.passwordHash = config.get("CURATOR_PASSWORD_HASH", { infer: true });
  }

  // clientKey: identificador del cliente para el rate-limit (req.ip; ver
  // LoginRateLimiterService sobre por qué no es confiable por sí solo).
  async login(username: string, password: string, clientKey: string): Promise<{ token: string; expiresAt: number }> {
    // Síncrono y antes de cualquier await: chequea el límite y registra el
    // intento como fallo provisorio en el mismo tick (ver
    // LoginRateLimiterService sobre la carrera que esto evita).
    const attempt = this.rateLimiter.beginAttempt(clientKey);
    try {
      // Las dos comparaciones corren siempre, sin cortocircuito: un usuario
      // incorrecto tarda lo mismo que una contraseña incorrecta (scrypt
      // incluido), así el tiempo de respuesta no revela cuál falló (AC 3.2).
      const usernameMatches = this.usernameMatches(username);
      const passwordMatches = await verifyPassword(password, this.passwordHash);

      // Fallo: no hay nada que registrar, beginAttempt ya lo contó.
      if (!usernameMatches || !passwordMatches) throw new InvalidCredentialsError();

      this.rateLimiter.recordSuccess(attempt);
      return this.sessions.issue();
    } finally {
      this.rateLimiter.release();
    }
  }

  // timingSafeEqual exige buffers del mismo largo: se comparan los SHA-256
  // de ambos lados para no filtrar la longitud del usuario configurado.
  private usernameMatches(candidate: string): boolean {
    const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
    return timingSafeEqual(digest(candidate), digest(this.username));
  }
}
