import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ResearchService } from "../research/research.service";
import { InsufficientEvidenceError } from "../research/research.errors";
import { DebateService } from "../debate/debate.service";
import { NoCrossExaminationTargetError } from "../debate/debate.errors";
import { AgentsService } from "../agents/agents.service";
import { FactCheckService } from "../fact-check/fact-check.service";
import { DailyQuotaExceededError } from "../ai/ai.errors";
import { TtsService } from "../tts/tts.service";
import { TtsProviderUnavailableError } from "../tts/tts.errors";
import { EpisodeParticipantsService } from "./episode-participants.service";
import { EpisodeStateService } from "./episode-state.service";
import { EpisodeBudgetService } from "./episode-budget.service";
import { EpisodeEventsService } from "./episode-events.service";
import { EpisodeOrchestratorService } from "./episode-orchestrator.service";
import { EpisodePipelineHaltedError } from "./episodes.errors";

const EPISODE_ID = "11111111-1111-4111-8111-111111111111";
const DEBATE_ID = "22222222-2222-4222-8222-222222222222";
const TOPIC_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const JUDGE_AGENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const PARTICIPANTS = [
  { id: "p1", episodeId: EPISODE_ID, agentId: AGENT_A, modelProvider: "GOOGLE", isJudge: false, agent: { id: AGENT_A, role: "ANALYST" } },
  { id: "p2", episodeId: EPISODE_ID, agentId: AGENT_B, modelProvider: "GOOGLE", isJudge: false, agent: { id: AGENT_B, role: "CONTRARIAN" } },
  { id: "p3", episodeId: EPISODE_ID, agentId: JUDGE_AGENT_ID, modelProvider: "GOOGLE", isJudge: true, agent: { id: JUDGE_AGENT_ID, role: "JUDGE" } },
];

// overrides permite ajustar rondas/participants por test sin repetir el shape
// completo — Fase B solo usaba "status", Fase C necesita además debate.topic
// (buildDebateContext) y las 3 rondas configurables (§7.2).
function episodeRow(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: EPISODE_ID,
    status,
    debateId: DEBATE_ID,
    debate: { id: DEBATE_ID, topicId: TOPIC_ID, topic: { id: TOPIC_ID, title: "Un trend" } },
    participants: PARTICIPANTS,
    usage: { episodeId: EPISODE_ID, llmCalls: 0, searchRequests: 0 },
    openingRounds: 1,
    rebuttalRounds: 0,
    crossExaminationRounds: 0,
    maxRevisionAttempts: 3,
    ...overrides,
  };
}

function makeAgentStub(content = "draft") {
  return {
    argue: jest.fn().mockResolvedValue({ content }),
    respond: jest.fn().mockResolvedValue({ content, respondsToId: "target-1" }),
    amend: jest.fn().mockResolvedValue({ content }),
  };
}

describe("EpisodeOrchestratorService", () => {
  let service: EpisodeOrchestratorService;
  let prisma: {
    episode: { findUniqueOrThrow: jest.Mock };
    evidenceFact: { count: jest.Mock; findMany: jest.Mock };
    debateRound: { findFirst: jest.Mock; findUniqueOrThrow: jest.Mock };
    argument: { findMany: jest.Mock };
    verdict: { findUnique: jest.Mock };
  };
  let researchService: { research: jest.Mock };
  let debateService: {
    createRound: jest.Mock;
    createDraftArgument: jest.Mock;
    promoteToOfficial: jest.Mock;
    rejectArgument: jest.Mock;
    reviseDraft: jest.Mock;
    pickCrossExaminationTarget: jest.Mock;
    createVerdict: jest.Mock;
  };
  let agentsService: { createDebateAgent: jest.Mock; judge: jest.Mock };
  let factCheckService: { extractClaims: jest.Mock; check: jest.Mock; editorialReview: jest.Mock };
  let participantsService: { selectParticipants: jest.Mock };
  let stateService: {
    markResearching: jest.Mock;
    markReadyForDebate: jest.Mock;
    markDebating: jest.Mock;
    markJudging: jest.Mock;
    markPendingReview: jest.Mock;
    requireHumanReview: jest.Mock;
    markGeneratingAudio: jest.Mock;
    markReadyForRender: jest.Mock;
  };
  let budgetService: { withLlmCall: jest.Mock; withSearchRequest: jest.Mock; withTtsCall: jest.Mock };
  let eventsService: { emit: jest.Mock; complete: jest.Mock };
  let ttsService: { getOrderedOfficialArguments: jest.Mock; synthesizeSegment: jest.Mock };

  beforeEach(async () => {
    prisma = {
      episode: { findUniqueOrThrow: jest.fn() },
      evidenceFact: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      debateRound: { findFirst: jest.fn().mockResolvedValue(null), findUniqueOrThrow: jest.fn() },
      argument: { findMany: jest.fn().mockResolvedValue([]) },
      verdict: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    researchService = { research: jest.fn() };
    debateService = {
      createRound: jest.fn().mockResolvedValue({ id: "round-1", round: 1, type: "OPENING", debateId: DEBATE_ID }),
      createDraftArgument: jest.fn().mockResolvedValue({ id: "arg-1", content: "draft" }),
      promoteToOfficial: jest.fn().mockResolvedValue({ id: "arg-1", content: "draft oficial", status: "OFFICIAL" }),
      rejectArgument: jest.fn().mockResolvedValue({ id: "arg-1", status: "REJECTED" }),
      reviseDraft: jest.fn().mockResolvedValue({ id: "arg-1", content: "draft enmendado" }),
      pickCrossExaminationTarget: jest.fn(),
      createVerdict: jest.fn().mockResolvedValue({ id: "verdict-1" }),
    };
    agentsService = {
      createDebateAgent: jest.fn().mockImplementation(() => makeAgentStub()),
      judge: jest.fn().mockResolvedValue({ content: "veredicto", winnerAgentId: AGENT_A }),
    };
    factCheckService = {
      extractClaims: jest.fn().mockResolvedValue([{ id: "claim-1", argumentId: "arg-1", statement: "s", type: "FACTUAL" }]),
      check: jest.fn().mockResolvedValue({ veracity: "TRUE", analysis: "ok", sourceIds: ["src-1"] }),
      editorialReview: jest.fn().mockResolvedValue({ passed: true }),
    };
    participantsService = { selectParticipants: jest.fn() };
    stateService = {
      markResearching: jest.fn(),
      markReadyForDebate: jest.fn(),
      markDebating: jest.fn(),
      markJudging: jest.fn(),
      markPendingReview: jest.fn(),
      requireHumanReview: jest.fn(),
      markGeneratingAudio: jest.fn(),
      markReadyForRender: jest.fn(),
    };
    // Reusadas tal cual en Fase C para runDebatePhase/processDraft — mismo
    // wrapper transparente que ejecuta fn() sin chequeo real de presupuesto,
    // porque EpisodeBudgetService ya tiene sus propios tests (Fase B).
    budgetService = {
      withLlmCall: jest.fn((_episodeId: string, fn: () => Promise<unknown>) => fn()),
      withSearchRequest: jest.fn((_episodeId: string, fn: () => Promise<unknown>) => fn()),
      withTtsCall: jest.fn((_episodeId: string, fn: () => Promise<unknown>) => fn()),
    };
    eventsService = { emit: jest.fn(), complete: jest.fn() };
    ttsService = { getOrderedOfficialArguments: jest.fn().mockResolvedValue([]), synthesizeSegment: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EpisodeOrchestratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: ResearchService, useValue: researchService },
        { provide: DebateService, useValue: debateService },
        { provide: AgentsService, useValue: agentsService },
        { provide: FactCheckService, useValue: factCheckService },
        { provide: TtsService, useValue: ttsService },
        { provide: EpisodeParticipantsService, useValue: participantsService },
        { provide: EpisodeStateService, useValue: stateService },
        { provide: EpisodeBudgetService, useValue: budgetService },
        { provide: EpisodeEventsService, useValue: eventsService },
      ],
    }).compile();

    service = module.get(EpisodeOrchestratorService);
  });

  describe("runResearchPhase", () => {
    it("CREATED: selecciona participantes, marca RESEARCHING, corre research y termina en READY_FOR_DEBATE", async () => {
      prisma.episode.findUniqueOrThrow
        .mockResolvedValueOnce(episodeRow("CREATED"))
        .mockResolvedValueOnce(episodeRow("RESEARCHING"));
      prisma.evidenceFact.count.mockResolvedValue(0);
      researchService.research.mockResolvedValue({ topic: "x", facts: [] });

      await service.runResearchPhase(EPISODE_ID);

      expect(participantsService.selectParticipants).toHaveBeenCalledWith(EPISODE_ID, DEBATE_ID);
      expect(stateService.markResearching).toHaveBeenCalledWith(EPISODE_ID);
      expect(researchService.research).toHaveBeenCalledWith(TOPIC_ID, undefined);
      expect(stateService.markReadyForDebate).toHaveBeenCalledWith(EPISODE_ID);
    });

    it("propaga manualSources a research() sin transformarlos", async () => {
      prisma.episode.findUniqueOrThrow
        .mockResolvedValueOnce(episodeRow("REQUIRES_HUMAN_REVIEW"))
        .mockResolvedValueOnce(episodeRow("REQUIRES_HUMAN_REVIEW"));
      prisma.evidenceFact.count.mockResolvedValue(0);
      researchService.research.mockResolvedValue({ topic: "x", facts: [] });
      const manualSources = [{ url: "https://x.com", title: "t", snippet: "s" }];

      await service.runResearchPhase(EPISODE_ID, manualSources);

      expect(participantsService.selectParticipants).not.toHaveBeenCalled();
      expect(stateService.markResearching).not.toHaveBeenCalled();
      expect(researchService.research).toHaveBeenCalledWith(TOPIC_ID, manualSources);
    });

    it("idempotencia: si ya existe research completa para el topic, no vuelve a llamar research()", async () => {
      prisma.episode.findUniqueOrThrow
        .mockResolvedValueOnce(episodeRow("RESEARCHING"))
        .mockResolvedValueOnce(episodeRow("RESEARCHING"));
      prisma.evidenceFact.count.mockResolvedValue(3);

      await service.runResearchPhase(EPISODE_ID);

      expect(researchService.research).not.toHaveBeenCalled();
      expect(stateService.markReadyForDebate).toHaveBeenCalledWith(EPISODE_ID);
    });

    it("no vuelve a marcar READY_FOR_DEBATE si el episodio ya está ahí", async () => {
      prisma.episode.findUniqueOrThrow
        .mockResolvedValueOnce(episodeRow("RESEARCHING"))
        .mockResolvedValueOnce(episodeRow("READY_FOR_DEBATE"));
      prisma.evidenceFact.count.mockResolvedValue(3);

      await service.runResearchPhase(EPISODE_ID);

      expect(stateService.markReadyForDebate).not.toHaveBeenCalled();
    });

    it("resume desde una fase posterior (DEBATING): no intenta markReadyForDebate (bug encontrado en revisión — ver comentario in-line)", async () => {
      prisma.episode.findUniqueOrThrow
        .mockResolvedValueOnce(episodeRow("DEBATING"))
        .mockResolvedValueOnce(episodeRow("DEBATING"));
      prisma.evidenceFact.count.mockResolvedValue(3); // research ya completa de la corrida anterior

      await expect(service.runResearchPhase(EPISODE_ID)).resolves.toBeUndefined();

      expect(stateService.markReadyForDebate).not.toHaveBeenCalled();
      expect(stateService.markResearching).not.toHaveBeenCalled();
    });

    it("propaga InsufficientEvidenceError sin capturarla y sin marcar READY_FOR_DEBATE", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValueOnce(episodeRow("RESEARCHING"));
      prisma.evidenceFact.count.mockResolvedValue(0);
      researchService.research.mockRejectedValue(new InsufficientEvidenceError(1));

      await expect(service.runResearchPhase(EPISODE_ID)).rejects.toThrow(InsufficientEvidenceError);
      expect(stateService.markReadyForDebate).not.toHaveBeenCalled();
    });
  });

  describe("runPipeline — pipeline feliz completo", () => {
    it("CREATED -> ... -> PENDING_REVIEW con 1 opening round, sin rebuttal ni cross-examination", async () => {
      researchService.research.mockResolvedValue({ topic: "x", facts: [] });
      prisma.evidenceFact.count.mockResolvedValue(0);

      prisma.episode.findUniqueOrThrow
        .mockResolvedValueOnce(episodeRow("CREATED")) // runResearchPhase: load
        .mockResolvedValueOnce(episodeRow("RESEARCHING")) // runResearchPhase: refreshed
        .mockResolvedValueOnce(episodeRow("READY_FOR_DEBATE")) // runDebatePhase: load
        .mockResolvedValueOnce(episodeRow("DEBATING")) // runJudgingPhase: load
        .mockResolvedValueOnce(episodeRow("JUDGING")); // runJudgingPhase: refreshed (select status)

      await service.runPipeline(EPISODE_ID);

      expect(stateService.markDebating).toHaveBeenCalledWith(EPISODE_ID);
      expect(stateService.markJudging).toHaveBeenCalledWith(EPISODE_ID);
      expect(stateService.markPendingReview).toHaveBeenCalledWith(EPISODE_ID);
      // 2 debatientes, 1 turno cada uno (1 opening round, 0 rebuttal, 0 cross-exam)
      expect(debateService.createDraftArgument).toHaveBeenCalledTimes(2);
      expect(debateService.promoteToOfficial).toHaveBeenCalledTimes(2);
      expect(agentsService.judge).toHaveBeenCalledWith(expect.anything(), "GOOGLE");
      expect(debateService.createVerdict).toHaveBeenCalledWith(DEBATE_ID, JUDGE_AGENT_ID, {
        content: "veredicto",
        winnerAgentId: AGENT_A,
      });
      expect(stateService.requireHumanReview).not.toHaveBeenCalled();
      // finally de runPipeline() cierra el Subject de SSE de este episodio,
      // haya terminado con éxito o no (EpisodeEventsService.complete).
      expect(eventsService.complete).toHaveBeenCalledWith(EPISODE_ID);
    });
  });

  describe("processDraft (loop de enmienda, §7.3)", () => {
    it("un claim falla una vez, se llama amend, la segunda vuelta pasa -> OFFICIAL", async () => {
      const agentInstance = makeAgentStub();
      factCheckService.extractClaims.mockResolvedValue([
        { id: "claim-1", argumentId: "arg-1", statement: "s1", type: "FACTUAL" },
      ]);
      factCheckService.check
        .mockResolvedValueOnce({ veracity: "FALSE", analysis: "está mal", sourceIds: ["src-1"] })
        .mockResolvedValueOnce({ veracity: "TRUE", analysis: "ahora ok", sourceIds: ["src-1"] });

      const context = { topic: "x", evidenceBase: { topic: "x", facts: [] }, officialArguments: [] };
      const round = { id: "round-1", round: 1, type: "OPENING", debateId: DEBATE_ID };

      // processDraft es privado — se llama vía reflection (patrón aceptado
      // para no tener que orquestar todo runDebatePhase solo para ejercitar
      // el loop de enmienda en aislamiento).
      const result = await (service as unknown as { processDraft: (p: unknown) => Promise<{ status: string }> }).processDraft({
        episodeId: EPISODE_ID,
        debateRound: round,
        agentId: AGENT_A,
        agentInstance,
        provider: "GOOGLE",
        persona: { id: "ANALYST" },
        roundType: "OPENING",
        initialContent: "draft",
        context,
        maxRevisionAttempts: 3,
      });

      expect(agentInstance.amend).toHaveBeenCalledTimes(1);
      expect(debateService.reviseDraft).toHaveBeenCalledWith("arg-1", "draft");
      expect(debateService.promoteToOfficial).toHaveBeenCalledWith("arg-1");
      expect(result.status).toBe("OFFICIAL");
    });

    it("editorialReview siempre usa GOOGLE, sin importar el provider real del debatiente (bug real, ver decision-log.md)", async () => {
      const agentInstance = makeAgentStub();
      factCheckService.extractClaims.mockResolvedValue([
        { id: "claim-1", argumentId: "arg-1", statement: "una opinión", type: "OPINION" },
      ]);
      factCheckService.editorialReview.mockResolvedValue({ passed: true });

      const context = { topic: "x", evidenceBase: { topic: "x", facts: [] }, officialArguments: [] };
      const round = { id: "round-1", round: 1, type: "OPENING", debateId: DEBATE_ID };

      await (service as unknown as { processDraft: (p: unknown) => Promise<unknown> }).processDraft({
        episodeId: EPISODE_ID,
        debateRound: round,
        agentId: AGENT_A,
        agentInstance,
        provider: "OPENROUTER", // el debatiente real usa OPENROUTER
        persona: { id: "ANALYST" },
        roundType: "OPENING",
        initialContent: "draft",
        context,
        maxRevisionAttempts: 3,
      });

      // EditorialReviewOutputSchema es el único schema con .refine()
      // condicional — se fuerza GOOGLE para esta llamada puntual (provider
      // real del proveedor, no "OPENROUTER"), mismo criterio que
      // EXTRACTION_PROVIDER en research.service.ts.
      expect(factCheckService.editorialReview).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        "GOOGLE",
        expect.anything()
      );
      expect(factCheckService.check).not.toHaveBeenCalled();
    });

    it("agota maxRevisionAttempts -> rejectArgument + requireHumanReview(MAX_REVISIONS_EXCEEDED) + EpisodePipelineHaltedError", async () => {
      const agentInstance = makeAgentStub();
      factCheckService.extractClaims.mockResolvedValue([
        { id: "claim-1", argumentId: "arg-1", statement: "s1", type: "FACTUAL" },
      ]);
      factCheckService.check.mockResolvedValue({ veracity: "FALSE", analysis: "siempre mal", sourceIds: ["src-1"] });

      const context = { topic: "x", evidenceBase: { topic: "x", facts: [] }, officialArguments: [] };
      const round = { id: "round-1", round: 1, type: "OPENING", debateId: DEBATE_ID };

      await expect(
        (service as unknown as { processDraft: (p: unknown) => Promise<unknown> }).processDraft({
          episodeId: EPISODE_ID,
          debateRound: round,
          agentId: AGENT_A,
          agentInstance,
          provider: "GOOGLE",
          persona: { id: "ANALYST" },
          roundType: "OPENING",
          initialContent: "draft",
          context,
          maxRevisionAttempts: 2,
        })
      ).rejects.toThrow(EpisodePipelineHaltedError);

      expect(debateService.rejectArgument).toHaveBeenCalledWith("arg-1");
      expect(stateService.requireHumanReview).toHaveBeenCalledWith(EPISODE_ID, "MAX_REVISIONS_EXCEEDED", "round-1");
    });
  });

  describe("handlePipelineError — mapeo de excepciones tipadas vía runPipeline", () => {
    it("InsufficientEvidenceError -> requireHumanReview(INSUFFICIENT_EVIDENCE)", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValueOnce(episodeRow("CREATED"));
      prisma.evidenceFact.count.mockResolvedValue(0);
      researchService.research.mockRejectedValue(new InsufficientEvidenceError(1));

      await service.runPipeline(EPISODE_ID);

      expect(stateService.requireHumanReview).toHaveBeenCalledWith(EPISODE_ID, "INSUFFICIENT_EVIDENCE");
    });

    it("DailyQuotaExceededError -> requireHumanReview(PROVIDER_QUOTA_EXCEEDED)", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValueOnce(episodeRow("CREATED"));
      prisma.evidenceFact.count.mockResolvedValue(0);
      researchService.research.mockRejectedValue(new DailyQuotaExceededError("GOOGLE", 500));

      await service.runPipeline(EPISODE_ID);

      expect(stateService.requireHumanReview).toHaveBeenCalledWith(EPISODE_ID, "PROVIDER_QUOTA_EXCEEDED");
    });

    it("NoCrossExaminationTargetError (runDebatePhase) -> requireHumanReview(VALIDATION_INCONSISTENCY)", async () => {
      researchService.research.mockResolvedValue({ topic: "x", facts: [] });
      prisma.evidenceFact.count.mockResolvedValue(0);
      debateService.pickCrossExaminationTarget.mockRejectedValue(new NoCrossExaminationTargetError(DEBATE_ID, AGENT_B));

      prisma.episode.findUniqueOrThrow
        .mockResolvedValueOnce(episodeRow("CREATED", { openingRounds: 0, rebuttalRounds: 0, crossExaminationRounds: 1 }))
        .mockResolvedValueOnce(episodeRow("RESEARCHING", { openingRounds: 0, rebuttalRounds: 0, crossExaminationRounds: 1 }))
        .mockResolvedValueOnce(episodeRow("READY_FOR_DEBATE", { openingRounds: 0, rebuttalRounds: 0, crossExaminationRounds: 1 }));

      await service.runPipeline(EPISODE_ID);

      expect(stateService.requireHumanReview).toHaveBeenCalledWith(EPISODE_ID, "VALIDATION_INCONSISTENCY");
    });
  });

  describe("runAudioPhase / runAudioPipeline (etapa 2 de TTS)", () => {
    it("idempotente: sintetiza solo los Argument sin audioAssetId, marca GENERATING_AUDIO al entrar y READY_FOR_RENDER al terminar", async () => {
      prisma.episode.findUniqueOrThrow
        .mockResolvedValueOnce({ status: "APPROVED" })
        .mockResolvedValueOnce({ status: "GENERATING_AUDIO" });
      ttsService.getOrderedOfficialArguments.mockResolvedValue([
        { id: "arg-1", audioAssetId: "existing-asset" },
        { id: "arg-2", audioAssetId: null },
      ]);
      ttsService.synthesizeSegment.mockResolvedValue({ id: "asset-2" });

      await service.runAudioPhase(EPISODE_ID);

      expect(stateService.markGeneratingAudio).toHaveBeenCalledWith(EPISODE_ID);
      expect(ttsService.synthesizeSegment).toHaveBeenCalledTimes(1);
      expect(ttsService.synthesizeSegment).toHaveBeenCalledWith(EPISODE_ID, { id: "arg-2", audioAssetId: null });
      expect(budgetService.withTtsCall).toHaveBeenCalledTimes(1);
      expect(stateService.markReadyForRender).toHaveBeenCalledWith(EPISODE_ID);
    });

    it("no re-transiciona a GENERATING_AUDIO si el episodio ya está ahí (re-entrada de resume/recovery)", async () => {
      prisma.episode.findUniqueOrThrow
        .mockResolvedValueOnce({ status: "GENERATING_AUDIO" })
        .mockResolvedValueOnce({ status: "GENERATING_AUDIO" });
      ttsService.getOrderedOfficialArguments.mockResolvedValue([]);

      await service.runAudioPhase(EPISODE_ID);

      expect(stateService.markGeneratingAudio).not.toHaveBeenCalled();
      expect(stateService.markReadyForRender).toHaveBeenCalledWith(EPISODE_ID);
    });

    it("TtsProviderUnavailableError -> requireHumanReview(PROVIDER_QUOTA_EXCEEDED) vía runAudioPipeline", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValueOnce({ status: "APPROVED" });
      ttsService.getOrderedOfficialArguments.mockResolvedValue([{ id: "arg-1", audioAssetId: null }]);
      ttsService.synthesizeSegment.mockRejectedValue(new TtsProviderUnavailableError("LOCAL"));

      await service.runAudioPipeline(EPISODE_ID);

      expect(stateService.requireHumanReview).toHaveBeenCalledWith(EPISODE_ID, "PROVIDER_QUOTA_EXCEEDED");
      expect(eventsService.complete).toHaveBeenCalledWith(EPISODE_ID);
    });
  });

  describe("resolveTurnOrder", () => {
    it("sin Argument todavía: sortea un orden con ambos agentId", async () => {
      prisma.debateRound.findFirst.mockResolvedValue(null);

      const order = await (
        service as unknown as { resolveTurnOrder: (debateId: string, participants: unknown[]) => Promise<string[]> }
      ).resolveTurnOrder(DEBATE_ID, [{ agentId: AGENT_A }, { agentId: AGENT_B }]);

      expect([...order].sort()).toEqual([AGENT_A, AGENT_B].sort());
    });

    it("con un Argument ya existente: respeta el orden ya fijado", async () => {
      prisma.debateRound.findFirst.mockResolvedValue({ id: "round-1" });
      prisma.argument.findMany.mockResolvedValue([{ agentId: AGENT_B }]);

      const order = await (
        service as unknown as { resolveTurnOrder: (debateId: string, participants: unknown[]) => Promise<string[]> }
      ).resolveTurnOrder(DEBATE_ID, [{ agentId: AGENT_A }, { agentId: AGENT_B }]);

      expect(order).toEqual([AGENT_B, AGENT_A]);
    });
  });

  describe("runRound — re-entrada idempotente", () => {
    it("un agente con Argument OFFICIAL ya persistido no vuelve a generar ese turno", async () => {
      prisma.debateRound.findFirst.mockResolvedValue({ id: "round-1", round: 1, type: "OPENING", debateId: DEBATE_ID });
      prisma.argument.findMany.mockImplementation(async (args: { select?: { agentId?: boolean }; where: { status?: string } }) => {
        if (args.select?.agentId && args.where.status === "OFFICIAL") return [{ agentId: AGENT_A }];
        return [];
      });
      factCheckService.extractClaims.mockResolvedValue([]);

      const agentInstanceB = makeAgentStub();
      await (
        service as unknown as {
          runRound: (
            episode: unknown,
            type: string,
            round: number,
            turnOrder: string[],
            debaterParticipants: unknown[],
            agentInstances: Map<string, unknown>
          ) => Promise<void>;
        }
      ).runRound(
        episodeRow("DEBATING"),
        "OPENING",
        1,
        [AGENT_A, AGENT_B],
        [
          { agentId: AGENT_A, agent: { role: "ANALYST" }, modelProvider: "GOOGLE" },
          { agentId: AGENT_B, agent: { role: "CONTRARIAN" }, modelProvider: "GOOGLE" },
        ],
        new Map([
          [AGENT_A, makeAgentStub()],
          [AGENT_B, agentInstanceB],
        ])
      );

      // Solo B: A ya tenía un Argument OFFICIAL en esta ronda (simulando un
      // resume/recovery a mitad de ronda).
      expect(debateService.createDraftArgument).toHaveBeenCalledTimes(1);
      expect(debateService.createDraftArgument).toHaveBeenCalledWith("round-1", AGENT_B, "draft", undefined);
    });
  });
});
