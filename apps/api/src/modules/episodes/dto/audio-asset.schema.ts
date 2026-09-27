import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import type { AudioAsset } from "@prisma/client";

// Valores exactos de schema.prisma:AudioProvider — mismo criterio que
// episode-status.schema.ts.
export const AudioProviderSchema = z.enum(["ELEVENLABS", "OPENAI", "GOOGLE_TTS", "LOCAL", "OPENROUTER"]);

// API-10 (spec 003): respuesta de la acción regenerate-audio, que devuelve
// el AudioAsset nuevo tal cual lo crea TtsService.regenerateSegmentByIndex.
// Mirror 1:1 de schema.prisma:AudioAsset, sin relaciones. Fechas como
// string ISO (mismo motivo que EpisodeSchema).
export const AudioAssetSchema = z.object({
  id: z.string().uuid(),
  // Clave interna del storage. Para reproducir, el cliente pide la URL
  // firmada (GET /episodes/:id/audio/:audioAssetId/url) o usa el manifest.
  storageKey: z.string(),
  provider: AudioProviderSchema,
  durationMs: z.number().int(),
  mimeType: z.string(),
  // Json? en Prisma: timing por palabra (AudioSubtitleCue[] de
  // tts/audio-provider.interface.ts), null si el proveedor no lo expone.
  subtitles: z
    .array(
      z.object({
        text: z.string(),
        startMs: z.number(),
        endMs: z.number(),
      })
    )
    .nullable(),
  // La voz usada al sintetizar (ADR 0002 punto 6). `.min(1)` también por el
  // OpenAPI: un z.string().nullable() suelto sale como type ["string","null"]
  // y, en una propiedad de primer nivel de un DTO, @nestjs/swagger toma ese
  // array como "array de string" (openapi.json quedaba con voiceId: string[]).
  // Con min(1) Zod genera anyOf con null, que nestjs-zod pasa a
  // `nullable: true`. Un id de voz vacío no existe (AgentVoice.voiceId).
  voiceId: z.string().min(1).nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export class AudioAssetDto extends createZodDto(AudioAssetSchema) {}
export type SerializedAudioAsset = z.infer<typeof AudioAssetSchema>;

// Borde HTTP (mismo criterio que serializeArgument). `subtitles` es Json? en
// Prisma: lo escribe solo TtsService.synthesizeAndSave con el
// AudioSubtitleCue[] del proveedor, o JsonNull; mismo cast que
// EpisodesService.getManifest.
export function serializeAudioAsset(asset: AudioAsset): SerializedAudioAsset {
  return {
    ...asset,
    subtitles: (asset.subtitles as unknown as SerializedAudioAsset["subtitles"]) ?? null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  };
}

// AC 6.1 — GET /episodes/:id/audio/:audioAssetId/url
// (TtsService.getSignedAudioUrl). URL relativa a /audio-files, firmada y de
// corta duración (AUDIO_URL_TTL_SECONDS).
export const SignedAudioUrlSchema = z.object({ url: z.string() });
export class SignedAudioUrlDto extends createZodDto(SignedAudioUrlSchema) {}
