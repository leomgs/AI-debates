import { z } from "zod";
import { createZodDto } from "nestjs-zod";

// Respuesta de POST /auth/login y GET /auth/session. Sin sesión válida,
// GET /auth/session no llega a responder esto: el SessionGuard corta antes
// con 401 UNAUTHORIZED. expiresAt es el vencimiento del token (7 días desde
// el login, AC 3.3), como ISO string (z.date() no se puede representar en
// JSON Schema, ver EpisodeSchema).
export const SessionSchema = z.object({
  authenticated: z.literal(true),
  expiresAt: z.iso.datetime(),
});
export class SessionDto extends createZodDto(SessionSchema) {}
