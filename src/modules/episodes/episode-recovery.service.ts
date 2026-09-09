import { Injectable, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { EpisodeOrchestratorService } from "./episode-orchestrator.service";

// features.md Feature 4 (idempotencia, escenario 1: "reanudación post-caída
// del proceso") — al bootstrapear, cualquier Episode que haya quedado en una
// fase activa (el proceso murió a mitad de camino, sin pasar por
// REQUIRES_HUMAN_REVIEW) se retoma llamando runPipeline() de nuevo. Reusa
// exactamente la misma idempotencia por re-chequeo de cada fase
// (episode-orchestrator.service.ts) que ya usan la corrida inicial y el
// resume manual — no hay lógica de recovery separada.
//
// RENDERING queda FUERA del `where` a propósito: Render no existe todavía
// (tasks.md sección 6, P1), así que un episodio nunca llega a ese estado
// hoy. Cuando ese módulo se implemente, sumarlo acá con el mismo criterio.
// GENERATING_AUDIO sí se cubre (etapa 2 de TTS) — implementación literal del
// escenario de Feature 4: "si el estado es GENERATING_AUDIO, se asume el
// guion como de solo lectura y se retoman exclusivamente las llamadas de
// audio pendientes" (runAudioPhase es idempotente por audioAssetId ya
// asignado, mismo mecanismo que el resto del pipeline).
@Injectable()
export class EpisodeRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EpisodeRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: EpisodeOrchestratorService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const stuck = await this.prisma.episode.findMany({
      where: { status: { in: ["RESEARCHING", "DEBATING", "JUDGING", "GENERATING_AUDIO"] } },
    });

    for (const episode of stuck) {
      this.logger.warn(`Retomando episodio ${episode.id} tras reinicio (status=${episode.status})`);
      // Fire-and-forget, mismo patrón que EpisodesService.createEpisode y
      // EpisodeActionsService.resume (decisión D-11 del plan) — no hay cola
      // de jobs, y bootstrap no debe bloquearse esperando que cada episodio
      // termine su pipeline.
      const pipeline =
        episode.status === "GENERATING_AUDIO"
          ? this.orchestrator.runAudioPipeline(episode.id)
          : this.orchestrator.runPipeline(episode.id);
      void pipeline.catch((err) => this.logger.error(`Recovery de ${episode.id} falló`, err instanceof Error ? err.stack : err));
    }
  }
}
