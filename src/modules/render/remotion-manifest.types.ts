import type { AudioSubtitleCue } from "../tts/audio-provider.interface";

// features.md Feature 7 (P0) — "Contrato Estricto (RemotionManifest)",
// congelado en v1.0. `audioUrl` NO está en el contrato original de
// features.md (solo `audioAssetId`), pero api-contract.md §2 promete
// "URLs firmadas resueltas para cada AudioAsset" en la respuesta del
// endpoint — se agrega como campo adicional (no reemplaza `audioAssetId`,
// que sigue siendo obligatorio) para cumplir esa promesa sin romper el
// contrato congelado. RenderService.buildManifest() no lo completa (es
// puro, sin TtsService) — lo agrega EpisodesService después, reusando
// TtsService.getSignedAudioUrl (AC 6.1). decision-log.md 2026-09-24, #27.
export interface RemotionManifestAgent {
  id: string;
  name: string;
  avatarUrl: string | null;
  voiceId: string;
}

export interface RemotionManifestTimelineEntry {
  sequenceIndex: number;
  agentId: string;
  text: string;
  audioAssetId: string;
  audioUrl?: string;
  durationMs: number;
  subtitles: AudioSubtitleCue[];
}

export interface RemotionManifestVerdict {
  winnerAgentId: string | null;
  summary: string;
}

export interface RemotionManifest {
  episodeId: string;
  meta: {
    topic: string;
    durationEstimatedSec: number;
  };
  agents: RemotionManifestAgent[];
  timeline: RemotionManifestTimelineEntry[];
  verdict: RemotionManifestVerdict;
}
