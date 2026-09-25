import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, OpenAPIObject, SwaggerModule, type OperationObject } from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { SESSION_COOKIE_NAME } from "../../modules/auth/session-cookie";
import { ErrorResponseDto } from "./error-response.dto";
import { OPENAPI_PUBLIC_EXTENSION } from "./public.decorator";

const SESSION_SECURITY_SCHEME = "session";
const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

// API-8 (ADR 0001, AC 3.5) — el SessionGuard global protege todo lo que no
// sea @Public(), así que el documento lo refleja igual: cada operación sin la
// marca x-public (la pone @Public(), public.decorator.ts) declara la cookie de
// sesión como security y un 401 UNAUTHORIZED con el envelope de error. Así un
// endpoint nuevo queda documentado como protegido sin tener que acordarse de
// decorarlo, igual que queda protegido en runtime. La marca x-public se borra
// acá: no llega a openapi.json.
function documentSessionRequirement(document: OpenAPIObject, errorSchemaRef: string): void {
  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method] as (OperationObject & Record<string, unknown>) | undefined;
      if (!operation) continue;

      if (operation[OPENAPI_PUBLIC_EXTENSION]) {
        delete operation[OPENAPI_PUBLIC_EXTENSION];
        continue;
      }

      operation.security = [{ [SESSION_SECURITY_SCHEME]: [] }];
      operation.responses["401"] ??= {
        description: "`UNAUTHORIZED`: falta la cookie de sesión, está alterada o venció.",
        content: { "application/json": { schema: { $ref: errorSchemaRef } } },
      };
    }
  }
}

// spec 001 (docs/product/001-openapi-contract-zod.md) — compartido entre
// main.ts (sirve /docs en vivo, solo fuera de producción) y
// scripts/generate-openapi.ts (escribe openapi.json) para que ambos
// documenten exactamente lo mismo, sin posibilidad de desincronizarse.
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("AI Trend Debates API")
    .setDescription("Pipeline automatizado que convierte un trend en un debate verificado entre agentes de IA.")
    .setVersion("1.0")
    .addTag("auth", "Sesión del curador (ADR 0001, spec 003 API-8)")
    .addTag("episodes", "Orquestación del pipeline y curaduría humana (api-contract.md §2/§3)")
    .addTag("notifications", "Inbox interno de notificaciones (Feature 4)")
    .addCookieAuth(
      SESSION_COOKIE_NAME,
      { type: "apiKey", in: "cookie", description: "Cookie httpOnly que emite POST /auth/login (7 días)." },
      SESSION_SECURITY_SCHEME
    )
    .build();

  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config, { extraModels: [ErrorResponseDto] }));
  documentSessionRequirement(document, `#/components/schemas/${ErrorResponseDto.name}`);
  return document;
}
