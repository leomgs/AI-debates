import { Injectable, Logger } from "@nestjs/common";
import { Argument, Claim, DebateRound, ModelProvider, Prisma, RoundType } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ResearchService } from "../research/research.service";
import { InsufficientEvidenceError } from "../research/research.errors";
import { DebateService } from "../debate/debate.service";
import { NoCrossExaminationTargetError } from "../debate/debate.errors";
import { AgentsService } from "../agents/agents.service";
import { FactCheckService } from "../fact-check/fact-check.service";
import { DailyQuotaExceededError, RateLimitWaitExceededError } from "../ai/ai.errors";
import { TtsService } from "../tts/tts.service";
import { TtsProviderUnavailableError } from "../tts/tts.errors";
import { EpisodeParticipantsService } from "./episode-participants.service";
import { EpisodeStateService } from "./episode-state.service";
import { EpisodeBudgetService } from "./episode-budget.service";
import { EpisodeEventsService } from "./episode-events.service";
import { EpisodeContextService } from "./episode-context.service";
import { BudgetExceededError, EpisodePipelineHaltedError } from "./episodes.errors";
import {
  AmendmentFeedback,
  ArgumentDraft,
  CrossExaminationDraft,
  DebateAgent,
  DebateContext,
  EditorialReviewOutput,
  FactCheckOutput,
} from "../../shared/contracts/agents.contracts";
import { DEBATER_PERSONAS, DebaterPersona } from "../../shared/personas/agents.personas";
import { EpisodeSseEventTypeSchema } from "./dto/episode-sse-event.schema";
import type { z } from "zod";

export interface ManualSource {
  url: string;
  title: string;
  snippet: string;
}

// Eventos SSE definidos en api-contract.md §4, emitidos vía
// EpisodeEventsService. Tipo derivado de EpisodeSseEventTypeSchema (spec
// 001, dto/episode-sse-event.schema.ts) — única fuente de verdad, no se
// repite el enum a mano acá.
type EpisodeSseEvent = z.infer<typeof EpisodeSseEventTypeSchema>;

// participants.agent (role -> persona/JUDGE) y debate.topic (título para el
// DebateContext) se agregaron en Fase C — Fase B solo necesitaba
// debate.topicId (escalar) y participants sin relación.
const EPISODE_LOAD_INCLUDE = {
  debate: { include: { topic: true } },
  participants: { include: { agent: true } },
  usage: true,
} satisfies Prisma.EpisodeInclude;

type EpisodeWithPipelineData = Prisma.EpisodeGetPayload<{ include: typeof EPISODE_LOAD_INCLUDE }>;
type EpisodeParticipantWithAgent = EpisodeWithPipelineData["participants"][number];

interface ProcessDraftParams {
  episodeId: string;
  debateRound: DebateRound;
  agentId: string;
  agentInstance: DebateAgent;
  provider: ModelProvider;
  persona: DebaterPersona;
  roundType: RoundType;
  initialContent: string;
  respondsToId?: string;
  context: DebateContext;
  maxRevisionAttempts: number;
}

// EditorialReviewOutputSchema es el único de los 7 schemas de generateObject
// del proyecto con un .refine() condicional (si passed=false, violatedRule y
// reason son obligatorios) — bug real encontrado corriendo
// scripts/smoke-test-episode.ts contra APIs reales (2026-09-08): un modelo
// :free de OpenRouter no logró cumplirlo tras agotar los reintentos de
// Cockatiel (AI_NoObjectGeneratedError). Se fuerza GOOGLE para esta llamada
// puntual, sea cual sea el provider real del debatiente — mismo criterio que
// EXTRACTION_PROVIDER en research.service.ts (GOOGLE es el único provider
// requerido/garantizado por env.schema.ts). El resto de las llamadas del
// argumento (extractClaims/check/argue/amend) siguen usando el provider real
// del debatiente sin cambios — no tienen refine, no mostraron este problema.
const EDITORIAL_REVIEW_PROVIDER = "GOOGLE" as const;

// UNSUPPORTED cuenta como falla, no solo FALSE/MISLEADING (decision-log.md
// 2026-09-09, #17) — un claim FACTUAL sin respaldo en la Evidence Base es
// exactamente lo que el system prompt del debatiente promete no hacer ("no
// inventes datos ni cifras"); dejarlo pasar permitía cifras inventadas
// (ratings de MyAnimeList inexistentes en la evidencia, visto en un smoke
// test real) sin disparar el loop de enmienda. CONTESTED queda afuera a
// propósito: implica que las fuentes se contradicen entre sí, no que el
// claim se inventó, y no hay caso real todavía que justifique tratarlo igual.
function isFactCheckFailure(result: FactCheckOutput): boolean {
  return (
    result.veracity === "FALSE" ||
    result.veracity === "MISLEADING" ||
    result.veracity === "UNSUPPORTED"
  );
}

function isEditorialFailure(result: EditorialReviewOutput): boolean {
  return result.passed === false;
}

// architecture.md §7 — orquestador del pipeline. Fase C agrega el loop de
// rondas de debate (§7.2), el loop de enmienda (§7.3) y el veredicto (§7.4),
// más el entrypoint runPipeline() que encadena las 3 fases con manejo de
// errores centralizado. Cada fase sigue siendo idempotente por re-chequeo de
// lo ya persistido (mismo patrón que runResearchPhase, Fase B) — es lo que
// permite reusar runPipeline tanto para la creación inicial como para un
// resume o una recuperación post-caída sin ramas de código por caller.
@Injectable()
export class EpisodeOrchestratorService {
  private readonly logger = new Logger(EpisodeOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly research: ResearchService,
    private readonly debate: DebateService,
    private readonly agents: AgentsService,
    private readonly factCheck: FactCheckService,
    private readonly tts: TtsService,
    private readonly participants: EpisodeParticipantsService,
    private readonly state: EpisodeStateService,
    private readonly budget: EpisodeBudgetService,
    private readonly events: EpisodeEventsService,
    private readonly context: EpisodeContextService
  ) {}

  // Entrypoint público único, reusado por creación (EpisodesService), resume
  // (EpisodeActionsService) y recovery post-caída (EpisodeRecoveryService,
  // Fase E) — el mapeo de errores tipados a REQUIRES_HUMAN_REVIEW es el mismo
  // sin importar quién dispara el pipeline. El `finally` cierra el Subject de
  // SSE de este episodio (EpisodeEventsService.complete) al terminar la
  // "sesión" de ejecución, haya sido éxito o error — evita que el Map interno
  // de EpisodeEventsService crezca sin límite.
  //
  // begin() va antes del primer await a propósito (API-12): los callers
  // disparan runPipeline sin await, y el marcado tiene que quedar hecho en
  // el mismo tick, antes de que respondan. Así un GET /episodes/:id o un SSE
  // pedidos apenas después de createEpisode/resume ya ven pipelineActive.
  async runPipeline(episodeId: string, opts?: { manualSources?: ManualSource[] }): Promise<void> {
    this.events.begin(episodeId);
    try {
      await this.runResearchPhase(episodeId, opts?.manualSources);
      await this.runDebatePhase(episodeId);
      await this.runJudgingPhase(episodeId);
    } catch (err) {
      await this.handlePipelineError(episodeId, err);
    } finally {
      this.events.complete(episodeId);
    }
  }

  // Idempotente por re-chequeo de lo ya persistido (no por un flag de
  // "progreso" separado) — así el mismo método sirve para la primera
  // corrida, un resume, y una recuperación post-caída sin ramas de código
  // distintas por caller (decisión del plan de EpisodesModule).
  async runResearchPhase(episodeId: string, manualSources?: ManualSource[]): Promise<void> {
    const episode = await this.load(episodeId);

    if (episode.status === "CREATED") {
      await this.participants.selectParticipants(episodeId, episode.debateId);
      await this.state.markResearching(episodeId);
    }

    this.emitEvent(episodeId, "research.started");

    const existing = await this.hasCompleteResearch(episode.debate.topicId);
    if (!existing) {
      // InsufficientEvidenceError (u otras excepciones tipadas de research())
      // NO se captura acá — la maneja runPipeline() vía handlePipelineError.
      await this.budget.withSearchRequest(episodeId, () =>
        this.budget.withLlmCall(episodeId, () => this.research.research(episode.debate.topicId, manualSources))
      );
    }

    // Guard explícito por status de origen (RESEARCHING), no "!== destino" —
    // runPipeline() se reusa para resume/recovery, y esta fase puede
    // ejecutarse con el episodio ya en DEBATING/JUDGING (checkpoint con
    // fromState posterior a RESEARCHING). Con "!== READY_FOR_DEBATE" ese
    // caso intentaba una transición inválida (DEBATING -> READY_FOR_DEBATE,
    // fuera del ALLOWED_FROM de EpisodeStateService) y rompía el pipeline
    // antes de llegar a runDebatePhase. Bug encontrado en revisión, no en
    // los tests generados (ninguno cubría resume desde una fase posterior).
    const refreshed = await this.load(episodeId);
    if (refreshed.status === "RESEARCHING") {
      await this.state.markReadyForDebate(episodeId);
    }
  }

  // architecture.md §7.2 — loop de rondas. Solo 2 de los 3 EpisodeParticipant
  // debaten (isJudge:false); el Judge recién se usa en runJudgingPhase.
  async runDebatePhase(episodeId: string): Promise<void> {
    const episode = await this.load(episodeId);
    if (episode.status === "READY_FOR_DEBATE" || episode.status === "REQUIRES_HUMAN_REVIEW") {
      await this.state.markDebating(episodeId);
    }

    const debaterParticipants = episode.participants.filter((p) => !p.isJudge);
    const agentInstances = new Map<string, DebateAgent>(
      debaterParticipants.map((p) => [
        p.agentId,
        this.agents.createDebateAgent(this.personaOf(p), p.modelProvider),
      ])
    );
    const turnOrder = await this.resolveTurnOrder(episode.debate.id, debaterParticipants);

    const phases: Array<[RoundType, number]> = [
      ["OPENING", episode.openingRounds],
      ["REBUTTAL", episode.rebuttalRounds],
      ["CROSS_EXAMINATION", episode.crossExaminationRounds],
    ];
    for (const [type, count] of phases) {
      for (let round = 1; round <= count; round++) {
        await this.runRound(episode, type, round, turnOrder, debaterParticipants, agentInstances);
      }
    }
  }

  async runJudgingPhase(episodeId: string): Promise<void> {
    const episode = await this.load(episodeId);
    if (episode.status === "DEBATING" || episode.status === "REQUIRES_HUMAN_REVIEW") {
      await this.state.markJudging(episodeId);
    }

    const existingVerdict = await this.prisma.verdict.findUnique({ where: { debateId: episode.debate.id } });
    if (!existingVerdict) {
      const context = await this.context.build(episodeId);
      const judgeParticipant = episode.participants.find((p) => p.isJudge);
      if (!judgeParticipant) {
        throw new Error(`Episodio ${episodeId} no tiene EpisodeParticipant con isJudge:true — inconsistencia de datos.`);
      }
      const verdict = await this.budget.withLlmCall(episodeId, () =>
        this.agents.judge(context, judgeParticipant.modelProvider)
      );
      await this.debate.createVerdict(episode.debate.id, judgeParticipant.agentId, verdict);
    }

    // Re-chequeo idempotente, mismo patrón que runResearchPhase: si ya está
    // en PENDING_REVIEW (re-entrada), markPendingReview() tiraría
    // InvalidEpisodeTransitionError (su ALLOWED_FROM es solo JUDGING).
    const refreshed = await this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId }, select: { status: true } });
    if (refreshed.status !== "PENDING_REVIEW") {
      await this.state.markPendingReview(episodeId);
    }
  }

  // Entrypoint público separado de runPipeline() a propósito: la transición
  // APPROVED -> GENERATING_AUDIO la dispara una acción humana explícita
  // (EpisodeActionsService.approve()), no el pipeline automático — a
  // diferencia de research/debate/judging, que se encadenan solos. Mismo
  // try/catch/finally que runPipeline (etapa 2 de TTS, tasks.md sección 5).
  async runAudioPipeline(episodeId: string): Promise<void> {
    this.events.begin(episodeId); // síncrono, mismo motivo que en runPipeline
    try {
      await this.runAudioPhase(episodeId);
    } catch (err) {
      await this.handlePipelineError(episodeId, err);
    } finally {
      this.events.complete(episodeId);
    }
  }

  // Idempotente por re-chequeo de lo ya persistido (mismo criterio que el
  // resto del pipeline): un Argument con audioAssetId ya asignado se salta,
  // lo que hace que esta misma fase sirva para la corrida inicial, un resume
  // y una recuperación post-caída (EpisodeRecoveryService) sin ramas de
  // código separadas — Feature 4: "si el estado es GENERATING_AUDIO, se
  // asume el guion como de solo lectura y se retoman exclusivamente las
  // llamadas de audio pendientes".
  async runAudioPhase(episodeId: string): Promise<void> {
    const episode = await this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId }, select: { status: true } });
    if (episode.status === "APPROVED" || episode.status === "REQUIRES_HUMAN_REVIEW") {
      await this.state.markGeneratingAudio(episodeId);
    }

    const ordered = await this.tts.getOrderedOfficialArguments(episodeId);
    for (const argument of ordered) {
      if (argument.audioAssetId) continue; // ya sintetizado — idempotencia de resume/recovery
      await this.budget.withTtsCall(episodeId, () => this.tts.synthesizeSegment(episodeId, argument));
    }

    // Guard explícito por status de origen, mismo motivo que
    // runResearchPhase (§7.3 arriba): esta fase puede re-ejecutarse con el
    // episodio ya en READY_FOR_RENDER (re-entrada idempotente).
    const refreshed = await this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId }, select: { status: true } });
    if (refreshed.status === "GENERATING_AUDIO") {
      await this.state.markReadyForRender(episodeId);
    }
  }

  // architecture.md §7.3 — loop de enmienda con paralelización acotada. Sin
  // agrupación manual por ModelProvider: LlmRateLimiterService ya serializa
  // correctamente por provider vía su mutex interno (confirmado en
  // llm-rate-limiter.service.ts), agrupar acá duplicaría esa garantía
  // (decisión D-7 del plan de EpisodesModule).
  private async processDraft(params: ProcessDraftParams): Promise<Argument> {
    const {
      episodeId,
      debateRound,
      agentId,
      agentInstance,
      provider,
      persona,
      roundType,
      respondsToId,
      context,
      maxRevisionAttempts,
    } = params;

    let currentContent = params.initialContent;
    let row = await this.debate.createDraftArgument(debateRound.id, agentId, currentContent, respondsToId);
    let attempts = 0;

    for (;;) {
      const claims: Claim[] = await this.budget.withLlmCall(episodeId, () =>
        this.factCheck.extractClaims(row.id, currentContent, provider)
      );
      this.emitEvent(episodeId, "agent.thinking", { agentId, round: debateRound.round });

      // Tipo explícito en withLlmCall<T>: sin esto, TS infiere T solo de la
      // primera rama del ternario (FactCheckOutput) y el cast de la segunda
      // rama (EditorialReviewOutput) dentro de findIndex/filter deja de
      // tipar — los dos schemas no se solapan lo suficiente como para que el
      // compilador lo permita implícitamente.
      const results = await Promise.all(
        claims.map((claim) =>
          this.budget.withLlmCall<FactCheckOutput | EditorialReviewOutput>(episodeId, () =>
            claim.type === "FACTUAL"
              ? this.factCheck.check(claim, context.evidenceBase, provider)
              : this.factCheck.editorialReview(claim, persona, EDITORIAL_REVIEW_PROVIDER, currentContent)
          )
        )
      );

      const failureIndex = results.findIndex((result, i) =>
        claims[i].type === "FACTUAL"
          ? isFactCheckFailure(result as FactCheckOutput)
          : isEditorialFailure(result as EditorialReviewOutput)
      );
      const errorsDetected = results.filter((result, i) =>
        claims[i].type === "FACTUAL"
          ? isFactCheckFailure(result as FactCheckOutput)
          : isEditorialFailure(result as EditorialReviewOutput)
      ).length;
      this.emitEvent(episodeId, "fact_check.completed", {
        status: failureIndex === -1 ? "PASSED" : "FAILED",
        errorsDetected,
      });

      if (failureIndex === -1) {
        const official = await this.debate.promoteToOfficial(row.id);
        this.emitEvent(episodeId, "argument.approved", { agentId, text: official.content });
        return official;
      }

      attempts += 1;
      if (attempts > maxRevisionAttempts) {
        await this.debate.rejectArgument(row.id);
        await this.state.requireHumanReview(episodeId, "MAX_REVISIONS_EXCEEDED", debateRound.id);
        // Señal de control — el pipeline ya transicionó el estado acá mismo,
        // handlePipelineError no debe volver a mapearla.
        throw new EpisodePipelineHaltedError(episodeId);
      }

      const failedClaim = claims[failureIndex];
      const failedResult = results[failureIndex];
      const feedback: AmendmentFeedback =
        failedClaim.type === "FACTUAL"
          ? {
              reason: "FACTUAL_ERROR",
              failedClaim: failedClaim.statement,
              details: (failedResult as FactCheckOutput).analysis,
            }
          : {
              reason: "PERSONA_VIOLATION",
              failedClaim: failedClaim.statement,
              details:
                (failedResult as EditorialReviewOutput).reason ??
                (failedResult as EditorialReviewOutput).violatedRule ??
                "Violación de reglas editoriales.",
            };

      const original: ArgumentDraft | CrossExaminationDraft = respondsToId
        ? { content: currentContent, respondsToId }
        : { content: currentContent };
      const amended = await this.budget.withLlmCall(episodeId, () =>
        agentInstance.amend(context, original, feedback, roundType)
      );
      currentContent = amended.content;
      row = await this.debate.reviseDraft(row.id, currentContent);
    }
  }

  private async runRound(
    episode: EpisodeWithPipelineData,
    type: RoundType,
    round: number,
    turnOrder: string[],
    debaterParticipants: EpisodeParticipantWithAgent[],
    agentInstances: Map<string, DebateAgent>
  ): Promise<void> {
    const debateRound = await this.getOrCreateRound(episode.debate.id, round, type);
    const officialAgentIds = new Set(
      (
        await this.prisma.argument.findMany({
          where: { debateRoundId: debateRound.id, status: "OFFICIAL" },
          select: { agentId: true },
        })
      ).map((a) => a.agentId)
    );

    for (const agentId of turnOrder) {
      if (officialAgentIds.has(agentId)) continue; // ya resuelto — idempotencia de resume/recovery

      const participant = debaterParticipants.find((p) => p.agentId === agentId);
      const opponent = debaterParticipants.find((p) => p.agentId !== agentId);
      const agentInstance = agentInstances.get(agentId);
      if (!participant || !opponent || !agentInstance) {
        throw new Error(`EpisodeParticipant/agente inconsistente para agentId=${agentId} en episodio ${episode.id}.`);
      }

      const persona = this.personaOf(participant);
      // Se reconstruye en cada turno (EpisodeContextService no cachea):
      // officialArguments crece con cada Argument promovido a OFFICIAL
      // dentro de la misma corrida.
      const context = await this.context.build(episode.id);

      let content: string;
      let respondsToId: string | undefined;
      if (type === "CROSS_EXAMINATION") {
        // Puede lanzar NoCrossExaminationTargetError — no se captura acá,
        // sube hasta runPipeline()/handlePipelineError.
        const target = await this.debate.pickCrossExaminationTarget(episode.debate.id, opponent.agentId);
        // pickCrossExaminationTarget devuelve el Argument sin su DebateRound
        // — se necesita el roundType real para armar el shape que espera
        // DebateAgent.respond() (DebateContext["officialArguments"][number]).
        const targetRound = await this.prisma.debateRound.findUniqueOrThrow({
          where: { id: target.debateRoundId },
        });
        const draft = await this.budget.withLlmCall(episode.id, () =>
          agentInstance.respond(context, {
            id: target.id,
            agentId: target.agentId,
            content: target.content,
            roundType: targetRound.type,
          })
        );
        content = draft.content;
        respondsToId = target.id;
      } else {
        const draft = await this.budget.withLlmCall(episode.id, () => agentInstance.argue(context, type));
        content = draft.content;
      }

      await this.processDraft({
        episodeId: episode.id,
        debateRound,
        agentId,
        agentInstance,
        provider: participant.modelProvider,
        persona,
        roundType: type,
        initialContent: content,
        respondsToId,
        context,
        maxRevisionAttempts: episode.maxRevisionAttempts,
      });
    }
  }

  // Decisión D-4 del plan: sin columna nueva en EpisodeParticipant. El orden
  // se sortea la primera vez que se necesita (ronda OPENING/1 todavía sin
  // Argument alguno) y queda "fijado" por el orden de createdAt del primer
  // Argument que exista en esa ronda — resistente a resume/recovery sin
  // necesitar un cursor persistido aparte.
  private async resolveTurnOrder(debateId: string, debaterParticipants: EpisodeParticipantWithAgent[]): Promise<string[]> {
    const allIds = debaterParticipants.map((p) => p.agentId);
    const firstRound = await this.prisma.debateRound.findFirst({ where: { debateId, round: 1, type: "OPENING" } });

    if (firstRound) {
      const existingArgs = await this.prisma.argument.findMany({
        where: { debateRoundId: firstRound.id },
        orderBy: { createdAt: "asc" },
        select: { agentId: true },
      });
      const seen: string[] = [];
      for (const a of existingArgs) {
        if (allIds.includes(a.agentId) && !seen.includes(a.agentId)) seen.push(a.agentId);
      }
      if (seen.length > 0) {
        const rest = allIds.filter((id) => !seen.includes(id));
        return [...seen, ...rest];
      }
    }

    return this.shuffle(allIds);
  }

  private async getOrCreateRound(debateId: string, round: number, type: RoundType): Promise<DebateRound> {
    const existing = await this.prisma.debateRound.findFirst({ where: { debateId, round, type } });
    return existing ?? this.debate.createRound(debateId, round, type);
  }

  // "Investigación completa" = existe al menos un EvidenceFact ya extraído
  // para este topic (no alcanza con que exista una ResearchSession vacía).
  // Una sola query con filtro de relación encadenado (EvidenceFact -> Source
  // -> ResearchSession.topicId), sin necesitar un count en dos pasos.
  private async hasCompleteResearch(topicId: string): Promise<boolean> {
    const count = await this.prisma.evidenceFact.count({
      where: { source: { researchSession: { topicId } } },
    });
    return count > 0;
  }

  private personaOf(participant: EpisodeParticipantWithAgent): DebaterPersona {
    return DEBATER_PERSONAS[participant.agent.role as DebaterPersona["id"]];
  }

  private shuffle<T>(items: T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  private async load(episodeId: string): Promise<EpisodeWithPipelineData> {
    return this.prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      include: EPISODE_LOAD_INCLUDE,
    });
  }

  // Mapeo de excepciones tipadas de los módulos de dominio a la transición de
  // Episode correspondiente (coding-rules.md §5 — solo EpisodesModule conoce
  // CheckpointReason). Un error no clasificado NO transiciona el status: el
  // episodio queda en su fase activa actual, recuperable por
  // EpisodeRecoveryService (Fase E) en el próximo restart del proceso, mismo
  // mecanismo que una caída real de proceso.
  private async handlePipelineError(episodeId: string, err: unknown): Promise<void> {
    if (err instanceof EpisodePipelineHaltedError) return;
    if (err instanceof InsufficientEvidenceError) {
      await this.state.requireHumanReview(episodeId, "INSUFFICIENT_EVIDENCE");
      return;
    }
    if (err instanceof NoCrossExaminationTargetError) {
      await this.state.requireHumanReview(episodeId, "VALIDATION_INCONSISTENCY");
      return;
    }
    if (err instanceof DailyQuotaExceededError || err instanceof RateLimitWaitExceededError) {
      await this.state.requireHumanReview(episodeId, "PROVIDER_QUOTA_EXCEEDED");
      return;
    }
    if (err instanceof TtsProviderUnavailableError) {
      // Mismo reason que DailyQuotaExceededError/RateLimitWaitExceededError
      // — "el proveedor externo no pudo resolver la llamada", sin necesidad
      // de un CheckpointReason nuevo (decision-log.md 2026-09-09, #20).
      await this.state.requireHumanReview(episodeId, "PROVIDER_QUOTA_EXCEEDED");
      return;
    }
    if (err instanceof BudgetExceededError) {
      await this.state.requireHumanReview(episodeId, "USAGE_LIMIT_EXCEEDED");
      return;
    }
    this.logger.error(`Error no clasificado en el pipeline del episodio ${episodeId}`, err instanceof Error ? err.stack : err);
  }

  private emitEvent(episodeId: string, type: EpisodeSseEvent, data?: unknown): void {
    this.events.emit(episodeId, type, data);
  }
}
