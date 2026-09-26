import { Injectable, Logger } from "@nestjs/common";
import { Argument, AudioAsset, CheckpointReason, Episode, EpisodeStatus } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { DebateService } from "../debate/debate.service";
import { AgentsService } from "../agents/agents.service";
import { TtsService } from "../tts/tts.service";
import { DEBATER_PERSONAS, DebaterPersona } from "../../shared/personas/agents.personas";
import { EpisodeStateService } from "./episode-state.service";
import { EpisodeBudgetService } from "./episode-budget.service";
import { EpisodeOrchestratorService, ManualSource } from "./episode-orchestrator.service";
import { EpisodeContextService } from "./episode-context.service";
import { InvalidEpisodeTransitionError } from "./episodes.errors";
import { serializeVerdict, SerializedVerdict } from "./episode-detail.mapper";
import { EditActionDto } from "./dto/edit-action.dto";
import { RegenerateActionDto } from "./dto/regenerate-action.dto";
import { RegenerateAudioActionDto } from "./dto/regenerate-audio-action.dto";
import {
  EmptyResumeSchema,
  InsufficientEvidenceResumeSchema,
  ResumeActionBody,
  UsageLimitResumeSchema,
} from "./dto/resume-action.dto";

// api-contract.md §3 — acciones de curaduría. `edit`/`regenerate` no cambian
// Episode.status (solo válidas EN el status PENDING_REVIEW), así que no pasan
// por EpisodeStateService — usan un assertStatus propio, más liviano que una
// transición real (coding-rules.md §6 solo exige centralizar las mutaciones
// de status, no cada chequeo de precondición).
@Injectable()
export class EpisodeActionsService {
  private readonly logger = new Logger(EpisodeActionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly debate: DebateService,
    private readonly agents: AgentsService,
    private readonly state: EpisodeStateService,
    private readonly budget: EpisodeBudgetService,
    private readonly orchestrator: EpisodeOrchestratorService,
    private readonly tts: TtsService,
    private readonly context: EpisodeContextService
  ) {}

  // Dispara la etapa 2 de TTS fire-and-forget, mismo criterio que
  // resume()/EpisodeRecoveryService (decisión D-11 del plan de
  // EpisodesModule) — approve() no debe bloquear esperando que termine de
  // sintetizar todo el audio del episodio.
  async approve(episodeId: string): Promise<Episode> {
    const episode = await this.state.markApproved(episodeId);
    void this.orchestrator
      .runAudioPipeline(episodeId)
      .catch((err) => this.logger.error(`runAudioPipeline (post-approve) falló para ${episodeId}`, err instanceof Error ? err.stack : err));
    return episode;
  }

  async edit(episodeId: string, dto: EditActionDto): Promise<Argument> {
    const episode = await this.assertStatus(episodeId, ["PENDING_REVIEW"], "edit");
    await this.findArgumentInEpisode(episode.debateId, dto.argumentId);
    return this.debate.editByHuman(dto.argumentId, dto.content);
  }

  // Reescritura editorial desde cero (api-contract.md §3: "no es lo mismo
  // que Resume") — el agente correcto (misma persona+provider que tenía
  // asignado) genera un argue()/respond() nuevo, SIN pasar por el loop de
  // fact-check de procesarBorrador. Se persiste con reviseDraft (no
  // editByHuman): el contenido sigue siendo AI_GENERATED, no HUMAN_EDITED —
  // editByHuman cambiaría el origin incorrectamente, ya que quien reescribió
  // el texto fue el agente, no el curador. El ArgumentHistoryStatus queda
  // como REJECTED (reviseDraft no tiene otra opción) aunque la etiqueta no
  // sea 100% precisa para este caso — no hay un status de historial dedicado
  // a "regenerado por pedido editorial", y agregar uno nuevo es más de lo
  // que este alcance pide.
  async regenerate(episodeId: string, dto: RegenerateActionDto): Promise<Argument> {
    const episode = await this.assertStatus(episodeId, ["PENDING_REVIEW"], "regenerate");

    const argument = await this.findArgumentInEpisode(episode.debateId, dto.argumentId);
    const participant = await this.prisma.episodeParticipant.findFirstOrThrow({
      where: { episodeId, agentId: argument.agentId },
      include: { agent: true },
    });
    const persona = DEBATER_PERSONAS[participant.agent.role as DebaterPersona["id"]];
    const agentInstance = this.agents.createDebateAgent(persona, participant.modelProvider);
    const context = await this.context.build(episodeId);

    let newContent: string;
    if (argument.debateRound.type === "CROSS_EXAMINATION") {
      if (!argument.respondsToId) {
        throw new Error(`Argument ${argument.id} es CROSS_EXAMINATION sin respondsToId — inconsistencia de datos.`);
      }
      const targetRow = await this.prisma.argument.findUniqueOrThrow({
        where: { id: argument.respondsToId },
        include: { debateRound: true },
      });
      // AC 2.1 (features.md Feature 2): toda llamada a LLM pasa por el
      // chequeo de presupuesto del episodio — regenerate() es una acción de
      // curaduría, pero sigue siendo una llamada real a un LLM, no una
      // excepción a la regla (gap encontrado en revisión, el resto del
      // pipeline ya lo hacía).
      const draft = await this.budget.withLlmCall(episodeId, () =>
        agentInstance.respond(context, {
          id: targetRow.id,
          agentId: targetRow.agentId,
          content: targetRow.content,
          roundType: targetRow.debateRound.type,
        })
      );
      newContent = draft.content;
    } else {
      const draft = await this.budget.withLlmCall(episodeId, () =>
        agentInstance.argue(context, argument.debateRound.type as "OPENING" | "REBUTTAL")
      );
      newContent = draft.content;
    }

    await this.debate.reviseDraft(dto.argumentId, newContent);
    return this.debate.promoteToOfficial(dto.argumentId);
  }

  // Spec 003, API-19 (D17): "Volver a juzgar". Sincrónica, como regenerate.
  // El juez evalúa los argumentos OFFICIAL actuales (EpisodeContextService,
  // el mismo contexto que usa el orquestador en JUDGING) con el
  // modelProvider que tiene asignado en el episodio, dentro de withLlmCall
  // (1 llamada del presupuesto, AC 2.1). Si el juez falla, withLlmCall
  // devuelve el cupo y el error se propaga sin tocar el veredicto
  // (BudgetExceededError → 409, cuota del proveedor → 503, resto → 500;
  // API-10b). La llamada puede tardar lo que espere el limitador de RPM,
  // así que el estado se vuelve a validar justo antes de escribir: si en el
  // medio se aprobó o rechazó el episodio, 409 y el veredicto queda como
  // estaba (la llamada ya se hizo, así que el cupo sí se consume).
  async regenerateVerdict(episodeId: string): Promise<SerializedVerdict> {
    const episode = await this.assertStatus(episodeId, ["PENDING_REVIEW"], "regenerate-verdict");
    const judge = await this.prisma.episodeParticipant.findFirstOrThrow({ where: { episodeId, isJudge: true } });
    const context = await this.context.build(episodeId);

    const output = await this.budget.withLlmCall(episodeId, () => this.agents.judge(context, judge.modelProvider));

    await this.assertStatus(episodeId, ["PENDING_REVIEW"], "regenerate-verdict");
    const verdict = await this.debate.replaceVerdict(episode.debateId, judge.agentId, output);
    // Recién emitido: ningún ArgumentHistory puede ser posterior.
    return serializeVerdict(verdict, false);
  }

  async reject(episodeId: string): Promise<Episode> {
    return this.state.markCancelled(episodeId);
  }

  // AC 6.2 (features.md Feature 6, etapa 3 de TTS) — a diferencia de
  // edit/regenerate (solo válidas en PENDING_REVIEW, antes de que exista
  // ningún audio), esta acción opera sobre audio ya sintetizado: solo tiene
  // sentido desde READY_FOR_RENDER, que es adonde llega un episodio recién
  // que EpisodeOrchestratorService.runAudioPhase termina de sintetizar todos
  // los segmentos (episode-state.service.ts, markReadyForRender).
  async regenerateAudio(episodeId: string, dto: RegenerateAudioActionDto): Promise<AudioAsset> {
    await this.assertStatus(episodeId, ["READY_FOR_RENDER"], "regenerate-audio");
    return this.budget.withTtsCall(episodeId, () => this.tts.regenerateSegmentByIndex(episodeId, dto.sequenceIndex));
  }

  // El body esperado depende de checkpoint.reason (api-contract.md §3) — el
  // controller ya validó que `body` matchea AL MENOS una de las 3 formas
  // conocidas (ResumeActionBodySchema, union), pero eso no garantiza que sea
  // la forma correcta PARA este checkpoint puntual (ej. un body vacío
  // matchea EmptyResumeSchema aunque el reason real sea USAGE_LIMIT_EXCEEDED,
  // que necesita datos). Acá se re-valida contra el schema específico del
  // reason real — si no matchea, el ZodError resultante lo mapea
  // HttpErrorFilter a 400 VALIDATION_ERROR.
  //
  // API-15 (spec 003): el estado se valida ANTES de aplicar los límites
  // nuevos. Antes, applyResumeBody escribía maxLlmCalls/maxSearchQueries y
  // recién después resumeFromCheckpoint tiraba el 409, así que un resume
  // inválido (por ejemplo, sobre un episodio en PENDING_REVIEW, cuyo último
  // checkpoint puede ser un USAGE_LIMIT_EXCEEDED ya resuelto) dejaba los
  // límites cambiados. resumeFromCheckpoint vuelve a validar al transicionar.
  async resume(episodeId: string, body: ResumeActionBody): Promise<Episode> {
    await this.assertStatus(episodeId, ["REQUIRES_HUMAN_REVIEW"], "resume");

    const checkpoint = await this.prisma.episodeCheckpoint.findFirst({
      where: { episodeId },
      orderBy: { createdAt: "desc" },
    });
    if (!checkpoint) {
      throw new InvalidEpisodeTransitionError("REQUIRES_HUMAN_REVIEW" as EpisodeStatus, "resume (sin checkpoint activo)");
    }

    const opts = await this.applyResumeBody(episodeId, checkpoint.reason, body);

    const episode = await this.state.resumeFromCheckpoint(episodeId);
    // Etapa 2 de TTS: un checkpoint con fromState GENERATING_AUDIO retoma
    // solo las llamadas de audio pendientes (runAudioPipeline, idempotente
    // por audioAssetId ya asignado) — runPipeline() rehace research/debate/
    // judging, que ya están completos y no deben re-ejecutarse.
    const resumedPipeline =
      checkpoint.fromState === "GENERATING_AUDIO"
        ? this.orchestrator.runAudioPipeline(episodeId)
        : this.orchestrator.runPipeline(episodeId, opts);
    void resumedPipeline.catch((err) =>
      this.logger.error(`pipeline (post-resume) falló para ${episodeId}`, err instanceof Error ? err.stack : err)
    );
    return episode;
  }

  private async applyResumeBody(
    episodeId: string,
    reason: CheckpointReason,
    body: unknown
  ): Promise<{ manualSources?: ManualSource[] } | undefined> {
    switch (reason) {
      case "USAGE_LIMIT_EXCEEDED": {
        const limits = UsageLimitResumeSchema.parse(body);
        await this.prisma.episode.update({
          where: { id: episodeId },
          data: {
            ...(limits.maxLlmCalls !== undefined ? { maxLlmCalls: limits.maxLlmCalls } : {}),
            ...(limits.maxSearchQueries !== undefined ? { maxSearchQueries: limits.maxSearchQueries } : {}),
          },
        });
        return undefined;
      }
      case "INSUFFICIENT_EVIDENCE": {
        const { manualSources } = InsufficientEvidenceResumeSchema.parse(body);
        return { manualSources };
      }
      case "MAX_REVISIONS_EXCEEDED":
      case "VALIDATION_INCONSISTENCY":
      case "PROVIDER_QUOTA_EXCEEDED":
        EmptyResumeSchema.parse(body);
        return undefined;
      default: {
        const _exhaustive: never = reason;
        return _exhaustive;
      }
    }
  }

  private async assertStatus(
    episodeId: string,
    allowed: EpisodeStatus[],
    attempted: string
  ): Promise<Episode & { debate: { id: string; topicId: string; topic: { id: string; title: string } } }> {
    const episode = await this.prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      include: { debate: { include: { topic: true } } },
    });
    if (!allowed.includes(episode.status)) {
      throw new InvalidEpisodeTransitionError(episode.status, attempted);
    }
    return episode;
  }

  // API-14 (spec 003): el argumentId tiene que ser de un round del debate de
  // ESTE episodio. Uno de otro episodio (o inexistente) no matchea el where,
  // findFirstOrThrow tira P2025 y HttpErrorFilter responde 404 NOT_FOUND:
  // mismo patrón que TtsService.getSignedAudioUrl con el audioAssetId.
  private async findArgumentInEpisode(debateId: string, argumentId: string) {
    return this.prisma.argument.findFirstOrThrow({
      where: { id: argumentId, debateRound: { debateId } },
      include: { debateRound: true },
    });
  }
}
