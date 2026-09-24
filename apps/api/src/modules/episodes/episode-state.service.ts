import { Injectable } from "@nestjs/common";
import { CheckpointReason, Episode, EpisodeStatus } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { EpisodeEventsService } from "./episode-events.service";
import { InvalidEpisodeTransitionError } from "./episodes.errors";

// Un método por ESTADO DESTINO (no por arista from->to) — cada uno valida
// contra el conjunto de estados de origen permitidos. Esto permite reusar el
// mismo método tanto en el flujo normal (CREATED -> RESEARCHING) como en un
// resume (REQUIRES_HUMAN_REVIEW -> RESEARCHING), sin duplicar lógica
// (coding-rules.md §6 — único escritor de Episode.status, un método por
// transición válida). REQUIRES_HUMAN_REVIEW/FAILED tienen lógica propia más
// abajo porque necesitan crear EpisodeCheckpoint, no solo mutar status.
const ALLOWED_FROM: Partial<Record<EpisodeStatus, EpisodeStatus[]>> = {
  RESEARCHING: ["CREATED", "REQUIRES_HUMAN_REVIEW"],
  READY_FOR_DEBATE: ["RESEARCHING"],
  DEBATING: ["READY_FOR_DEBATE", "REQUIRES_HUMAN_REVIEW"],
  JUDGING: ["DEBATING", "REQUIRES_HUMAN_REVIEW"],
  PENDING_REVIEW: ["JUDGING"],
  APPROVED: ["PENDING_REVIEW"],
  CANCELLED: ["PENDING_REVIEW", "REQUIRES_HUMAN_REVIEW"],
  // Etapa 2 de TTS (tasks.md sección 5) — mismo patrón que el resto: un
  // método por estado destino, reusado en flujo normal y en resume/recovery.
  GENERATING_AUDIO: ["APPROVED", "REQUIRES_HUMAN_REVIEW"],
  READY_FOR_RENDER: ["GENERATING_AUDIO"],
};

// markFailed() se usa en dos escenarios con la misma mecánica (crear
// checkpoint final + notificar): (a) escalación interna desde
// requireHumanReview() cuando la misma causa se repite (el episodio en ese
// momento todavía está en la fase activa donde falló, no en
// REQUIRES_HUMAN_REVIEW — nunca llegó a transicionar ahí), y (b) un futuro
// caller que quiera terminar un episodio ya parqueado en
// REQUIRES_HUMAN_REVIEW sin pasar por un resume. Por eso el conjunto de
// origen permitido es más amplio que "solo REQUIRES_HUMAN_REVIEW".
const FAILED_ALLOWED_FROM: EpisodeStatus[] = [
  "RESEARCHING",
  "DEBATING",
  "JUDGING",
  "GENERATING_AUDIO",
  "REQUIRES_HUMAN_REVIEW",
];

// RENDERING/COMPLETED todavía no tienen método — Render no existe (YAGNI,
// tasks.md sección 6, P1). Se agregan después con el mismo patrón
// (ALLOWED_FROM + notify), sin tocar lo ya escrito acá.

@Injectable()
export class EpisodeStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly events: EpisodeEventsService
  ) {}

  async markResearching(episodeId: string): Promise<Episode> {
    return this.transition(episodeId, "RESEARCHING");
  }

  async markReadyForDebate(episodeId: string): Promise<Episode> {
    return this.transition(episodeId, "READY_FOR_DEBATE");
  }

  async markDebating(episodeId: string): Promise<Episode> {
    return this.transition(episodeId, "DEBATING");
  }

  async markJudging(episodeId: string): Promise<Episode> {
    return this.transition(episodeId, "JUDGING");
  }

  async markPendingReview(episodeId: string): Promise<Episode> {
    const episode = await this.transition(episodeId, "PENDING_REVIEW");
    await this.notifications.notify(episodeId, "EPISODE_PENDING_REVIEW");
    // api-contract.md §4 — evento SSE en vivo, complementario a la
    // Notification persistida (gap encontrado en revisión: EpisodeEventsService
    // se agregó en una fase posterior a esta, y nadie volvió a conectar este
    // método con el evento que el contrato ya prometía).
    this.events.emit(episodeId, "episode.pending_review");
    return episode;
  }

  async markApproved(episodeId: string): Promise<Episode> {
    // Sin NotificationType para este caso en el diseño aprobado
    // (decision-log.md 2026-09-08 #9) — no notifica.
    return this.transition(episodeId, "APPROVED");
  }

  async markCancelled(episodeId: string): Promise<Episode> {
    // Ídem: reject/CANCELLED no dispara notificación en el diseño aprobado.
    return this.transition(episodeId, "CANCELLED");
  }

  // Etapa 2 de TTS — sin NotificationType propio (mismo criterio que
  // markApproved/markCancelled: son transiciones internas del pipeline
  // automático, no un desenlace que requiera avisar al curador fuera de la
  // pantalla del episodio; el SSE en vivo sigue cubriendo visibilidad).
  async markGeneratingAudio(episodeId: string): Promise<Episode> {
    return this.transition(episodeId, "GENERATING_AUDIO");
  }

  async markReadyForRender(episodeId: string): Promise<Episode> {
    return this.transition(episodeId, "READY_FOR_RENDER");
  }

  // Estado transversal (features.md Feature 4): se gatilla desde CUALQUIER
  // fase activa. Detección de "la misma causa volvió a ocurrir tras un
  // resume": se compara `reason` contra el EpisodeCheckpoint más reciente de
  // este episodio. La única forma de tener un checkpoint previo es haber
  // pasado por acá y por un `resume` explícito del curador — así que "mismo
  // reason que el checkpoint anterior" ES, por construcción, "la causa se
  // repitió" (no hace falta ningún contador aparte).
  async requireHumanReview(episodeId: string, reason: CheckpointReason, debateRoundId?: string): Promise<Episode> {
    const episode = await this.loadOrThrow(episodeId);
    this.assertFrom(episode.status, ["RESEARCHING", "DEBATING", "JUDGING", "GENERATING_AUDIO"], "REQUIRES_HUMAN_REVIEW");

    const lastCheckpoint = await this.prisma.episodeCheckpoint.findFirst({
      where: { episodeId },
      orderBy: { createdAt: "desc" },
    });

    if (lastCheckpoint?.reason === reason) {
      // Escala directo a FAILED sin crear otro checkpoint de
      // REQUIRES_HUMAN_REVIEW — el episodio nunca vuelve a pasar por ese
      // status intermedio en este ciclo, va directo de la fase activa a
      // FAILED (features.md: "no hay un tercer intento automático").
      return this.markFailed(episodeId, reason, debateRoundId);
    }

    const usage = await this.prisma.episodeUsage.findUniqueOrThrow({ where: { episodeId } });
    await this.prisma.episodeCheckpoint.create({
      data: { episodeId, fromState: episode.status, reason, debateRoundId, snapshot: JSON.stringify(usage) },
    });
    const updated = await this.prisma.episode.update({
      where: { id: episodeId },
      data: { status: "REQUIRES_HUMAN_REVIEW" },
    });
    await this.notifications.notify(episodeId, "EPISODE_REQUIRES_REVIEW", reason);
    // api-contract.md §4: event episode.requires_review, payload {reason, checkpoint}
    this.events.emit(episodeId, "episode.requires_review", {
      reason,
      checkpoint: { fromState: episode.status, reason, debateRoundId, createdAt: new Date() },
    });
    return updated;
  }

  // Terminal (features.md: "errores de sistema no clasificables, o una
  // causa de REQUIRES_HUMAN_REVIEW que persiste después de un Resume").
  // Crea un checkpoint final (para no perder el historial de por qué falló
  // definitivamente — Feature 10, nunca se pisa) y notifica.
  async markFailed(episodeId: string, reason: CheckpointReason, debateRoundId?: string): Promise<Episode> {
    const episode = await this.loadOrThrow(episodeId);
    this.assertFrom(episode.status, FAILED_ALLOWED_FROM, "FAILED");

    const usage = await this.prisma.episodeUsage.findUniqueOrThrow({ where: { episodeId } });
    await this.prisma.episodeCheckpoint.create({
      data: { episodeId, fromState: episode.status, reason, debateRoundId, snapshot: JSON.stringify(usage) },
    });
    const updated = await this.prisma.episode.update({ where: { id: episodeId }, data: { status: "FAILED" } });
    await this.notifications.notify(episodeId, "EPISODE_FAILED", reason);
    return updated;
  }

  // Resolución de la acción `resume` (api-contract.md §3): reanuda EXACTO
  // desde checkpoint.fromState — no crea checkpoint nuevo, no notifica (es
  // un des-congelamiento, no un desenlace). El curador ya vio la causa antes
  // de disparar esta acción.
  async resumeFromCheckpoint(episodeId: string): Promise<Episode> {
    const episode = await this.loadOrThrow(episodeId);
    this.assertFrom(episode.status, ["REQUIRES_HUMAN_REVIEW"], "resume");

    const checkpoint = await this.prisma.episodeCheckpoint.findFirstOrThrow({
      where: { episodeId },
      orderBy: { createdAt: "desc" },
    });
    return this.prisma.episode.update({ where: { id: episodeId }, data: { status: checkpoint.fromState } });
  }

  private async transition(episodeId: string, to: EpisodeStatus): Promise<Episode> {
    const episode = await this.loadOrThrow(episodeId);
    this.assertFrom(episode.status, ALLOWED_FROM[to] ?? [], to);
    return this.prisma.episode.update({ where: { id: episodeId }, data: { status: to } });
  }

  private async loadOrThrow(episodeId: string): Promise<Episode> {
    return this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId } });
  }

  private assertFrom(current: EpisodeStatus, allowed: readonly EpisodeStatus[], attempted: string): void {
    if (!allowed.includes(current)) {
      throw new InvalidEpisodeTransitionError(current, attempted);
    }
  }
}
