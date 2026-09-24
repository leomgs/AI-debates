import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";

// spec 001 (docs/product/001-openapi-contract-zod.md) — compartido entre
// main.ts (sirve /docs en vivo) y scripts/generate-openapi.ts (escribe
// openapi.json) para que ambos documenten exactamente lo mismo, sin
// posibilidad de desincronizarse entre sí.
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("AI Trend Debates API")
    .setDescription("Pipeline automatizado que convierte un trend en un debate verificado entre agentes de IA.")
    .setVersion("1.0")
    .addTag("episodes", "Orquestación del pipeline y curaduría humana (api-contract.md §2/§3)")
    .addTag("notifications", "Inbox interno de notificaciones (Feature 4)")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  return cleanupOpenApiDoc(document);
}
