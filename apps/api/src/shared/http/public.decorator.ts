import { SetMetadata, applyDecorators } from "@nestjs/common";
import { ApiExtension } from "@nestjs/swagger";

// ADR 0001 punto 1 — el SessionGuard global (modules/auth) niega por
// defecto; @Public() es la única forma de abrir un handler (o un controller
// entero) sin sesión. Hoy: POST /auth/login, POST /auth/logout y GET /.
// Todo endpoint nuevo queda protegido salvo que lo marque explícitamente.
export const IS_PUBLIC_KEY = "isPublic";

// Marca de OpenAPI que lee buildOpenApiDocument (openapi-document.ts) para
// saber qué operaciones NO documentar con 401 + security. Se consume y se
// borra ahí: no llega a openapi.json.
export const OPENAPI_PUBLIC_EXTENSION = "x-public";

export const Public = () => applyDecorators(SetMetadata(IS_PUBLIC_KEY, true), ApiExtension(OPENAPI_PUBLIC_EXTENSION, true));
