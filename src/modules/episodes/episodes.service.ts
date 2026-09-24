import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { Episode, EpisodeStatus } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ResearchService } from "../research/research.service";
import { DebateService } from "../debate/debate.service";
import { TtsService } from "../tts/tts.service";
import type { AudioSubtitleCue } from "../tts/audio-provider.interface";
import { RenderService } from "../render/render.service";
import type { RemotionManifest } from "../render/remotion-manifest.types";
import { EpisodeOrchestratorService } from "./episode-orchestrator.service";
import { EPISODE_DETAIL_INCLUDE, mapEpisodeDetail, EpisodeDetailResponse } from "./episode-detail.mapper";

const VALID_STATUSES = new Set<string>(Object.values(EpisodeStatus));

export interface EpisodeListItem {
  id: string;
  status: EpisodeStatus;
  title: string;
  createdAt: Date;
}

@Injectable()
export class EpisodesService {
  private readonly logger = new Logger(EpisodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly research: ResearchService,
    private readonly debateService: DebateService,
    private readonly orchestrator: EpisodeOrchestratorService,
    private readonly tts: TtsService,
    private readonly render: RenderService
  ) {}

  // Orden: Topic (le pertenece a ResearchModule) -> Debate (requiere
  // topicId) -> Episode (requiere debateId, @unique) -> EpisodeUsage
  // (requiere episodeId, @unique) — cada paso depende del id del anterior.
  // Topic.context reusa el mismo string que title: ResearchService.research()
  // no lee `context` en ningún lado hoy, no hay pérdida de información real
  // (decision-log.md 2026-09-08, plan EpisodesModule, decisión D-9).
  //
  // runPipeline se dispara fire-and-forget (sin await, sin cola de jobs —
  // decisión D-11 del plan): POST /episodes responde apenas el Episode existe
  // en CREATED, el pipeline corre en background. Si el proceso cae a mitad de
  // camino, EpisodeRecoveryService (Fase E) lo retoma al reiniciar.
  async createEpisode(topic: string): Promise<Episode> {
    const topicRow = await this.research.createTopic(topic, topic);
    const debate = await this.debateService.createDebate(topicRow.id);
    const episode = await this.prisma.episode.create({ data: { debateId: debate.id, title: topic } });
    await this.prisma.episodeUsage.create({ data: { episodeId: episode.id } });

    void this.orchestrator
      .runPipeline(episode.id)
      .catch((err) => this.logger.error(`runPipeline falló para el episodio ${episode.id}`, err instanceof Error ? err.stack : err));

    return episode;
  }

  async listEpisodes(statusCsv?: string): Promise<EpisodeListItem[]> {
    const statuses = this.parseStatusFilter(statusCsv);
    return this.prisma.episode.findMany({
      where: statuses ? { status: { in: statuses } } : undefined,
      select: { id: true, status: true, title: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async getEpisodeDetail(id: string): Promise<EpisodeDetailResponse> {
    const episode = await this.prisma.episode.findUniqueOrThrow({
      where: { id },
      include: EPISODE_DETAIL_INCLUDE,
    });
    return mapEpisodeDetail(episode);
  }

  // Feature 7 (features.md, P0) — GET /episodes/:id/manifest. Orquesta 3
  // fuentes (architecture.md §3, "ningún módulo de dominio importa a
  // otro"): Prisma directo para title/participants/verdict,
  // TtsService.getOrderedOfficialArguments (ya trae audioAsset,
  // decision-log.md #27) para el timeline, y RenderService.buildManifest
  // (puro) para armar el contrato. Las URLs firmadas se resuelven acá
  // después, reusando TtsService.getSignedAudioUrl (AC 6.1) — RenderService
  // no conoce TtsService.
  async getManifest(episodeId: string): Promise<RemotionManifest> {
    const episode = await this.prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: { title: true, debate: { select: { verdict: true } } },
    });
    const participants = await this.prisma.episodeParticipant.findMany({
      where: { episodeId },
      include: { agent: true },
    });
    const officialArguments = await this.tts.getOrderedOfficialArguments(episodeId);

    const manifest = this.render.buildManifest({
      episodeId,
      topic: episode.title,
      participants: participants.map((p) => ({
        agentId: p.agent.id,
        name: p.agent.name,
        avatarUrl: p.agent.avatarUrl,
        voiceId: this.tts.resolveVoiceId(p.agent.voiceId),
      })),
      officialArguments: officialArguments.map((a) => ({
        agentId: a.agentId,
        content: a.content,
        audioAssetId: a.audioAssetId,
        durationMs: a.audioAsset?.durationMs ?? null,
        subtitles: (a.audioAsset?.subtitles as unknown as AudioSubtitleCue[] | null) ?? null,
      })),
      verdict: episode.debate.verdict
        ? { winnerId: episode.debate.verdict.winnerId, content: episode.debate.verdict.content }
        : null,
    });

    const timeline = await Promise.all(
      manifest.timeline.map(async (entry) => ({
        ...entry,
        audioUrl: (await this.tts.getSignedAudioUrl(episodeId, entry.audioAssetId)).url,
      }))
    );

    return { ...manifest, timeline };
  }

  // api-contract.md §2: "GET /episodes?status=PENDING_REVIEW,REQUIRES_HUMAN_REVIEW"
  // — CSV de EpisodeStatus. La validación completa vía DTO Zod llega en Fase D
  // (dto/list-episodes-query.dto.ts); acá alcanza con no dejar pasar un
  // status inválido silencioso hacia la query de Prisma.
  private parseStatusFilter(statusCsv?: string): EpisodeStatus[] | undefined {
    if (!statusCsv) return undefined;
    const statuses = statusCsv.split(",").map((s) => s.trim());
    const invalid = statuses.filter((s) => !VALID_STATUSES.has(s));
    if (invalid.length > 0) {
      throw new BadRequestException(`status inválido en el filtro: ${invalid.join(", ")}`);
    }
    return statuses as EpisodeStatus[];
  }
}
