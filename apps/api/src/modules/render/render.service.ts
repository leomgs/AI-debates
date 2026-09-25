import { Injectable } from "@nestjs/common";
import type { AudioSubtitleCue } from "../tts/audio-provider.interface";
import { ManifestNotReadyError } from "./render.errors";
import type { DebateLanguage, RemotionManifest } from "@ai-trend-debates/contracts";

// PROVISORIO (spec 004, paso 3 antes del paso 7): el contrato ya exige
// `meta.language` (tasks.md §13.3), pero la columna Episode.language recién
// nace en la migración del paso 4 (§13.4). Hasta entonces todo episodio es
// español, que es lo que produce el pipeline hoy, y la migración va a
// etiquetar como ES a los episodios existentes (AC 4.5). En §13 paso 7
// (tasks.md §13.7) `language` entra a BuildManifestInput, leído de
// Episode.language por EpisodesService, y esta constante se borra.
const MANIFEST_LANGUAGE_UNTIL_EPISODE_LANGUAGE: DebateLanguage = "ES";

export interface RenderManifestParticipant {
  agentId: string;
  name: string;
  avatarUrl: string | null;
  voiceId: string;
}

export interface RenderManifestArgument {
  agentId: string;
  content: string;
  audioAssetId: string | null;
  durationMs: number | null;
  subtitles: AudioSubtitleCue[] | null;
}

export interface RenderManifestVerdict {
  winnerId: string | null;
  content: string;
}

export interface BuildManifestInput {
  episodeId: string;
  topic: string;
  participants: RenderManifestParticipant[];
  // Mismo set/orden que TtsService.getOrderedOfficialArguments (createdAt
  // asc sobre TODOS los Argument OFFICIAL del Debate, sin agrupar por
  // ronda) — sequenceIndex (1-based) se deriva de la posición en este
  // array, no de una columna nueva (mismo criterio que AC 6.2,
  // decision-log.md 2026-09-09 #20 punto 3). Quien arma este input
  // (EpisodesService) es responsable de mantener ese orden.
  officialArguments: RenderManifestArgument[];
  verdict: RenderManifestVerdict | null;
}

// Feature 7 (features.md, P0) — puro, sin Prisma ni ningún otro módulo de
// dominio inyectado: recibe datos ya resueltos por EpisodesService (único
// que orquesta varios módulos, architecture.md §3) y arma el contrato
// RemotionManifest. `audioUrl` NO se resuelve acá (requeriría TtsService,
// y "ningún módulo de dominio importa a otro" — architecture.md §3) — lo
// agrega EpisodesService después de llamar a este método, reusando
// TtsService.getSignedAudioUrl (AC 6.1, ya construido en la etapa 3 de TTS).
@Injectable()
export class RenderService {
  buildManifest(input: BuildManifestInput): RemotionManifest {
    if (!input.verdict) {
      throw new ManifestNotReadyError(input.episodeId);
    }

    const timeline = input.officialArguments.map((argument, index) => {
      if (!argument.audioAssetId || argument.durationMs === null) {
        throw new ManifestNotReadyError(input.episodeId);
      }
      return {
        sequenceIndex: index + 1,
        agentId: argument.agentId,
        text: argument.content,
        audioAssetId: argument.audioAssetId,
        durationMs: argument.durationMs,
        subtitles: argument.subtitles ?? [],
      };
    });

    // Metadato informativo (features.md Feature 7: "durationEstimatedSec
    // pasa a ser estrictamente un metadato informativo"), no un estimado
    // pre-TTS — este módulo solo arma el manifest cuando el audio real ya
    // existe (ManifestNotReadyError si no), así que la suma de durationMs
    // reales de cada segmento es el dato disponible más preciso, no una
    // proyección previa a la síntesis. decision-log.md 2026-09-24, #27.
    const durationEstimatedSec = Math.round(timeline.reduce((total, entry) => total + entry.durationMs, 0) / 1000);

    return {
      episodeId: input.episodeId,
      meta: { topic: input.topic, language: MANIFEST_LANGUAGE_UNTIL_EPISODE_LANGUAGE, durationEstimatedSec },
      agents: input.participants.map((p) => ({
        id: p.agentId,
        name: p.name,
        avatarUrl: p.avatarUrl,
        voiceId: p.voiceId,
      })),
      timeline,
      verdict: { winnerAgentId: input.verdict.winnerId, summary: input.verdict.content },
    };
  }
}
