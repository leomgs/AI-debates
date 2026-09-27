import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { DebateLanguageSchema } from "@ai-trend-debates/contracts";
import { EpisodeStatusSchema } from "./episode-status.schema";

// Mirror 1:1 de schema.prisma:Episode (spec 001, alcance: respuestas de
// POST /episodes y las acciones approve/reject/resume, que devuelven la fila
// completa vía EpisodeActionsService). No incluye relaciones (usage,
// checkpoints, debate, participants, notifications) — eso es
// EpisodeDetailSchema (episode-detail.mapper.ts), un shape recortado
// distinto para GET /episodes/:id.
export const EpisodeSchema = z.object({
  id: z.string().uuid(),
  debateId: z.string().uuid(),
  title: z.string(),
  // Json? sin usar hoy (decision-log.md #27 — el manifest se genera al
  // vuelo en cada GET /episodes/:id/manifest, no se persiste acá). Se
  // documenta como unknown, no como RemotionManifest, para no prometer un
  // shape que el campo nunca tiene en la práctica.
  remotionManifest: z.unknown().nullable(),
  status: EpisodeStatusSchema,
  // Spec 004 (AC 4.18): idioma del debate, fijo desde la creación (AC 4.3).
  language: DebateLanguageSchema,
  // string ISO, no z.date(): Zod 4 no puede representar z.date() en JSON
  // Schema ("Date cannot be represented in JSON Schema", nestjs-zod no
  // expone override para esto — issue conocido de la librería, confirmado
  // corriendo openapi:generate a mano). El valor real que arma
  // EpisodesService (no Prisma directo) ya llega como ISO string.
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  // API-7a (spec 003): null hasta que exista la acción `publish` (API-7).
  publishedAt: z.iso.datetime().nullable(),
  maxLlmCalls: z.number().int(),
  maxSearchQueries: z.number().int(),
  maxTtsSegments: z.number().int(),
  maxRevisionAttempts: z.number().int(),
  openingRounds: z.number().int(),
  rebuttalRounds: z.number().int(),
  crossExaminationRounds: z.number().int(),
});

// spec 001 (@ZodResponse) — POST /episodes, .../actions/approve, .../reject,
// .../resume devuelven la fila completa (EpisodeActionsService).
export class EpisodeDto extends createZodDto(EpisodeSchema) {}
export type SerializedEpisode = z.infer<typeof EpisodeSchema>;

// api-contract.md §2 — GET /episodes. Shape ya recortado en
// EpisodesService.EpisodeListItem (episodes.service.ts) — este schema
// documenta esa misma proyección, no la fila completa de Episode.
export const EpisodeListItemSchema = z.object({
  id: z.string().uuid(),
  status: EpisodeStatusSchema,
  title: z.string(),
  // Spec 004 (AC 4.18; API-1 parte 2): distintivo de idioma en la lista.
  language: DebateLanguageSchema,
  createdAt: z.iso.datetime(),
  // API-7a (spec 003, AC 3.17): distintivo "Publicado" en la lista.
  publishedAt: z.iso.datetime().nullable(),
});

// spec 001 (@ZodResponse) — GET /episodes.
export class EpisodeListItemDto extends createZodDto(EpisodeListItemSchema) {}
export type SerializedEpisodeListItem = z.infer<typeof EpisodeListItemSchema>;
