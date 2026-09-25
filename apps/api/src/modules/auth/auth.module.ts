import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { LoginRateLimiterService } from "./login-rate-limiter.service";
import { SessionGuard } from "./session.guard";
import { SessionService } from "./session.service";

// Auth del curador (ADR 0001, spec 003 API-8). Módulo de aplicación sin
// tablas propias (la credencial vive en el .env, la sesión es un token
// firmado sin estado) y sin dependencias con los módulos de dominio.
// Registra el SessionGuard como APP_GUARD: aplica a todos los controllers
// de la app, no solo a los de este módulo, y niega por defecto (@Public()
// en shared/http/ abre excepciones puntuales).
@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, LoginRateLimiterService, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AuthModule {}
