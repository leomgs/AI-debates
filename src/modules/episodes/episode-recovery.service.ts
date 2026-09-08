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
// GENERATING_AUDIO/RENDERING quedan FUERA del `where` a propósito: TTS/Render
// no existen todavía (tasks.md secciones 5/6), así que un episodio nunca
// llega a esos estados hoy. Cuando esos módulos se implementen, sumarlos acá
// con el mismo criterio.
@Injectable()
export class EpisodeRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EpisodeRecoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orchestrator: EpisodeOrchestratorService
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const stuck = await this.prisma.episode.findMany({
      where: { status: { in: ["RESEARCHING", "DEBATING", "JUDGING"] } },
    });

    for (const episode of stuck) {
      this.logger.warn(`Retomando episodio ${episode.id} tras reinicio (status=${episode.status})`);
      // Fire-and-forget, mismo patrón que EpisodesService.createEpisode y
      // EpisodeActionsService.resume (decisión D-11 del plan) — no hay cola
      // de jobs, y bootstrap no debe bloquearse esperando que cada episodio
      // termine su pipeline.
      void this.orchestrator
        .runPipeline(episode.id)
        .catch((err) => this.logger.error(`Recovery de ${episode.id} falló`, err instanceof Error ? err.stack : err));
    }
  }
}
