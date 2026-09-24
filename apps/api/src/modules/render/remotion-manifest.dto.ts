import { createZodDto } from "nestjs-zod";
import { RemotionManifestSchema } from "@ai-trend-debates/contracts";

// spec 001 (@ZodResponse) — GET /episodes/:id/manifest. Envuelve el schema
// compartido de @ai-trend-debates/contracts (spec 002) con createZodDto —
// packages/contracts no depende de nestjs-zod/@nestjs/swagger, eso es un
// detalle de la capa HTTP de este módulo, no del contrato en sí.
export class RemotionManifestDto extends createZodDto(RemotionManifestSchema) {}
