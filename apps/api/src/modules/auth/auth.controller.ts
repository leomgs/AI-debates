import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";
import type { Request, Response } from "express";
import { Public } from "../../shared/http/public.decorator";
import { ErrorResponseDto } from "../../shared/http/error-response.dto";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { SESSION_COOKIE_NAME } from "./session-cookie";
import { LoginDto } from "./dto/login.dto";
import { SessionDto } from "./dto/session.dto";

function toSessionDto(expiresAt: number) {
  return { authenticated: true as const, expiresAt: new Date(expiresAt).toISOString() };
}

// ADR 0001 punto 1, spec 003 API-8 (AC 3.1-3.9). login y logout son
// públicos; GET /auth/session pasa por el SessionGuard como cualquier otro
// endpoint (sin sesión válida responde 401 UNAUTHORIZED, que es justamente
// la respuesta a "¿hay sesión?"). La cookie se setea acá (es transporte
// HTTP); la credencial y el token los resuelven AuthService/SessionService.
@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService
  ) {}

  @Public()
  @Post("login")
  @ApiOperation({ operationId: "login" })
  @ZodResponse({ status: 200, type: SessionDto, description: "Credencial correcta: emite la cookie de sesión (7 días)." })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: "`INVALID_CREDENTIALS`: usuario o contraseña incorrectos (no indica cuál)." })
  @ApiResponse({
    status: 429,
    type: ErrorResponseDto,
    description:
      "`TOO_MANY_ATTEMPTS`: demasiados intentos fallidos, reintentar después de `Retry-After` segundos (hasta 900). " +
      "`LOGIN_BUSY`: ya hay verificaciones de contraseña en curso, reintentar en `Retry-After` segundos (1); no cuenta como fallo.",
    headers: { "Retry-After": { description: "Segundos hasta que se vuelve a aceptar un intento.", schema: { type: "integer" } } },
  })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // req.ip respeta `trust proxy` (main.ts); ver LoginRateLimiterService.
    const session = await this.auth.login(dto.username, dto.password, req.ip ?? req.socket.remoteAddress ?? "unknown");
    res.cookie(SESSION_COOKIE_NAME, session.token, this.sessions.cookieOptionsForLogin());
    return toSessionDto(session.expiresAt);
  }

  // Público e idempotente: borrar la cookie no requiere tener una válida.
  // No revoca copias de la cookie hechas antes (sesión sin estado, ADR 0001).
  @Public()
  @Post("logout")
  @HttpCode(204)
  @ApiOperation({ operationId: "logout" })
  @ApiResponse({ status: 204, description: "Cookie de sesión borrada." })
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, this.sessions.cookieOptionsForLogout());
  }

  @Get("session")
  @ApiOperation({ operationId: "getSession" })
  @ZodResponse({ status: 200, type: SessionDto, description: "Hay sesión válida." })
  session(@Req() req: Request) {
    const check = this.sessions.check(req.headers.cookie);
    // El SessionGuard ya validó la cookie; esto solo cubre el caso borde de
    // que venza entre el guard y esta línea.
    if (!check.valid) throw new UnauthorizedException("Sesión inválida o vencida. Iniciá sesión de nuevo.");
    return toSessionDto(check.expiresAt);
  }
}
