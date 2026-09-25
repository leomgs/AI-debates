import { z } from "zod";

// Spec 004 (docs/product/004-debate-language.md), AC 4.19: idioma del debate
// de un episodio. Vive en packages/contracts porque lo comparten apps/api
// (DTOs, Prisma, pipeline) y packages/video (manifest.meta.language), y el
// dashboard lo toma del enum generado en openapi.json. `.meta({ id })` para
// que el OpenAPI lo nombre DebateLanguage en vez de repetir el enum inline
// en cada lugar donde aparece (AC 4.18).
//
// Mismos literales que el enum DebateLanguage de schema.prisma (coding-rules
// §7), que nace en la migración de la spec 004, paso 4 (tasks.md §13.4).
export const DebateLanguageSchema = z.enum(["ES", "EN", "PT"]).meta({ id: "DebateLanguage" });

export type DebateLanguage = z.infer<typeof DebateLanguageSchema>;
