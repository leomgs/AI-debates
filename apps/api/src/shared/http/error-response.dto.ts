import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { ErrorCodeSchema } from "./error-codes";

// Envelope de error de toda la API (api-contract.md §1), el mismo que arma
// HttpErrorFilter. Existe como DTO para poder documentarlo en OpenAPI (401
// de todo endpoint protegido, los 401/429 del login y, desde API-10, los
// errores de episodios y acciones); el filter no lo usa para serializar,
// pero tipa su respuesta con ErrorResponse, así que no pueden divergir.
export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
  }),
});
export class ErrorResponseDto extends createZodDto(ErrorResponseSchema) {}
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
