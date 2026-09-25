import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { IS_PUBLIC_KEY } from "../../shared/http/public.decorator";
import { SessionService } from "./session.service";

// Guard global (APP_GUARD en AuthModule, ADR 0001 punto 1): niega por
// defecto. Todo handler de Nest exige una cookie de sesión válida salvo que
// él o su controller estén marcados con @Public(). Cubre también el SSE
// (@Sse corre los guards antes de abrir el stream, así que responde un 401
// JSON normal) y /notifications. No cubre lo que no es un handler de Nest:
// /audio-files y /public (middleware de Express, protegidos por firma o
// públicos a propósito) ni /docs (Swagger, que en producción no se monta).
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    // Solo hay superficie HTTP; cualquier otro contexto se niega.
    if (context.getType() !== "http") return false;

    const request = context.switchToHttp().getRequest<Request>();
    if (!this.sessions.check(request.headers.cookie).valid) {
      // HttpErrorFilter -> 401 { error: { code: "UNAUTHORIZED", ... } } (AC 3.5)
      throw new UnauthorizedException("Sesión inválida o vencida. Iniciá sesión de nuevo.");
    }
    return true;
  }
}
