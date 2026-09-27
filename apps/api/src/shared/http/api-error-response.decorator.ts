import { ApiResponse } from "@nestjs/swagger";
import { ErrorResponseDto } from "./error-response.dto";

// API-10 (spec 003): una respuesta de error documentada con el envelope
// { error: { code, message } } (ErrorResponseDto, `code` del enum
// ErrorCode). La descripción nombra qué codes puede traer ese status en ese
// endpoint puntual, que el schema solo no dice (el enum es el de toda la
// API). El 401 UNAUTHORIZED no hace falta: buildOpenApiDocument lo agrega a
// toda operación protegida.
export const ApiErrorResponse = (status: number, description: string) =>
  ApiResponse({ status, type: ErrorResponseDto, description });
