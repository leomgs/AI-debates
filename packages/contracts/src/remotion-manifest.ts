import { z } from "zod";
import { DebateLanguageSchema } from "./debate-language";

// spec 002 (docs/product/002-workspace-restructure.md) — vive en
// packages/contracts porque es el contrato entre apps/api y packages/video,
// y no pertenece a ninguno de los dos. Solo Zod como dependencia — ninguna
// clase createZodDto/nestjs-zod acá: eso es un detalle de la capa HTTP de
// apps/api (ver src/modules/render/remotion-manifest.dto.ts), y
// packages/video no tiene ninguna razón para depender de @nestjs/swagger.
//
// features.md Feature 7 (P0) — "Contrato Estricto (RemotionManifest)",
// congelado en v1.0. `audioUrl` NO está en el contrato original de
// features.md (solo `audioAssetId`), pero api-contract.md §2 promete
// "URLs firmadas resueltas para cada AudioAsset" en la respuesta del
// endpoint — se agrega como campo adicional (no reemplaza `audioAssetId`,
// que sigue siendo obligatorio) para cumplir esa promesa sin romper el
// contrato congelado. RenderService.buildManifest() no lo completa (es
// puro, sin TtsService) — lo agrega EpisodesService después, reusando
// TtsService.getSignedAudioUrl (AC 6.1). decision-log.md 2026-09-24, #27.
//
// Migrado de interfaces TS planas a Zod (spec 001, docs/product/
// 001-openapi-contract-zod.md) para que GET /episodes/:id/manifest tenga
// un @ZodResponse real en el OpenAPI generado — antes de esto, ninguna
// respuesta GET del proyecto se validaba con Zod en runtime (precedente
// documentado en decision-log.md #27). El shape de `subtitles` se define
// acá mismo, no se importa AudioSubtitleCue de tts/ (arquitectura §3,
// límite de módulo: render no depende de tts).
const AudioSubtitleCueSchema = z.object({
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});

export const RemotionManifestAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  voiceId: z.string(),
});

export const RemotionManifestTimelineEntrySchema = z.object({
  sequenceIndex: z.number().int().positive(),
  agentId: z.string().uuid(),
  text: z.string(),
  audioAssetId: z.string().uuid(),
  audioUrl: z.string().optional(),
  durationMs: z.number().int().nonnegative(),
  subtitles: z.array(AudioSubtitleCueSchema),
});

export const RemotionManifestVerdictSchema = z.object({
  winnerAgentId: z.string().uuid().nullable(),
  summary: z.string(),
});

export const RemotionManifestSchema = z.object({
  episodeId: z.string().uuid(),
  meta: z.object({
    topic: z.string(),
    // Spec 004 (AC 4.18, 4.19): idioma del debate, obligatorio. Extensión
    // documentada de Feature 7 (features.md, congelado, no lo lista), mismo
    // precedente que `audioUrl` (decision-log.md #27). El showcase lo lee de
    // acá (API-7, AC 3.67).
    language: DebateLanguageSchema,
    durationEstimatedSec: z.number().nonnegative(),
  }),
  agents: z.array(RemotionManifestAgentSchema),
  timeline: z.array(RemotionManifestTimelineEntrySchema),
  verdict: RemotionManifestVerdictSchema,
});

export type RemotionManifestAgent = z.infer<typeof RemotionManifestAgentSchema>;
export type RemotionManifestTimelineEntry = z.infer<typeof RemotionManifestTimelineEntrySchema>;
export type RemotionManifestVerdict = z.infer<typeof RemotionManifestVerdictSchema>;
export type RemotionManifest = z.infer<typeof RemotionManifestSchema>;
