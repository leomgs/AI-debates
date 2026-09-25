import { z } from "zod";
import { createZodDto } from "nestjs-zod";

// POST /auth/login (spec 003 API-8). Topes de largo defensivos: la
// contraseña pasa por scrypt, no tiene sentido aceptar megabytes.
export const LoginSchema = z
  .object({
    username: z.string().min(1).max(200),
    password: z.string().min(1).max(1024),
  })
  .strict();
export class LoginDto extends createZodDto(LoginSchema) {}
