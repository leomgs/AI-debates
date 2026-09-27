import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import type { Argument } from "@prisma/client";

// Valores exactos de schema.prisma:ArgumentStatus / ArgumentOrigin — mismo
// criterio que episode-status.schema.ts.
export const ArgumentStatusSchema = z.enum(["DRAFT", "OFFICIAL", "REJECTED"]);
export const ArgumentOriginSchema = z.enum(["AI_GENERATED", "HUMAN_EDITED"]);

// API-10 (spec 003): respuesta de las acciones edit y regenerate, que
// devuelven la fila de Argument tal cual la deja DebateService
// (editByHuman / regenerateArgument). Mirror 1:1 de schema.prisma:Argument,
// sin relaciones. Fechas como string ISO (mismo motivo que EpisodeSchema):
// Express serializa el Date de Prisma a ISO al responder.
export const ArgumentSchema = z.object({
  id: z.string().uuid(),
  debateRoundId: z.string().uuid(),
  agentId: z.string().uuid(),
  content: z.string(),
  // null hasta la etapa 2 de TTS; en PENDING_REVIEW (único estado de edit y
  // regenerate) siempre es null.
  audioAssetId: z.string().uuid().nullable(),
  status: ArgumentStatusSchema,
  origin: ArgumentOriginSchema,
  // Solo CROSS_EXAMINATION: el argumento al que responde.
  respondsToId: z.string().uuid().nullable(),
  createdAt: z.iso.datetime(),
});

export class ArgumentDto extends createZodDto(ArgumentSchema) {}

export type SerializedArgument = z.infer<typeof ArgumentSchema>;

// Borde HTTP (mismo criterio que createEpisode con EpisodeSchema): el Date
// de Prisma pasa a ISO acá, para que el tipo que devuelve el handler
// coincida con el que documenta @ZodResponse.
export function serializeArgument(argument: Argument): SerializedArgument {
  return { ...argument, createdAt: argument.createdAt.toISOString() };
}
