import { z } from "zod";
import { createZodDto } from "nestjs-zod";

// Envelope de error de toda la API (api-contract.md §1), el mismo que arma
// HttpErrorFilter. Existe como DTO para poder documentarlo en OpenAPI (401
// de todo endpoint protegido y los 401/429 del login, API-8); el filter no
// lo usa para serializar.
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});
export class ErrorResponseDto extends createZodDto(ErrorResponseSchema) {}
