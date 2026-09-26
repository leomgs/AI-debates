import { Test, TestingModule } from "@nestjs/testing";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { DebateService } from "../debate/debate.service";
import { AgentsService } from "../agents/agents.service";
import { EpisodeStateService } from "./episode-state.service";
import { EpisodeBudgetService } from "./episode-budget.service";
import { EpisodeOrchestratorService } from "./episode-orchestrator.service";
import { TtsService } from "../tts/tts.service";
import { EpisodeActionsService } from "./episode-actions.service";
import { EpisodeContextService } from "./episode-context.service";
import { BudgetExceededError, InvalidEpisodeTransitionError } from "./episodes.errors";
import { DailyQuotaExceededError } from "../ai/ai.errors";

const EPISODE_ID = "11111111-1111-4111-8111-111111111111";
const ARG_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";
const DEBATE_ID = "44444444-4444-4444-8444-444444444444";
const TOPIC_ID = "55555555-5555-4555-8555-555555555555";
const FOREIGN_ARG_ID = "66666666-6666-4666-8666-666666666666";
const JUDGE_ID = "77777777-7777-4777-8777-777777777777";
const JUDGE_OUTPUT = { content: "Ganó el analista.", winnerAgentId: AGENT_ID };
const NEW_VERDICT_ROW = {
  id: "88888888-8888-4888-8888-888888888888",
  debateId: DEBATE_ID,
  judgeId: JUDGE_ID,
  content: "Ganó el analista.",
  winnerId: AGENT_ID,
  createdAt: new Date("2026-09-26T10:00:00.000Z"),
};

// Lo que tira Prisma cuando un *OrThrow no encuentra la fila.
function notFound() {
  return new Prisma.PrismaClientKnownRequestError("No record was found for a query.", { code: "P2025", clientVersion: "test" });
}

function episodeWithDebate(status: string) {
  return {
    id: EPISODE_ID,
    status,
    debateId: DEBATE_ID,
    debate: { id: DEBATE_ID, topicId: TOPIC_ID, topic: { id: TOPIC_ID, title: "Un trend" } },
  };
}

describe("EpisodeActionsService", () => {
  let service: EpisodeActionsService;
  let prisma: {
    episode: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    episodeCheckpoint: { findFirst: jest.Mock };
    episodeParticipant: { findFirstOrThrow: jest.Mock; findMany: jest.Mock };
    argument: { findUniqueOrThrow: jest.Mock; findFirstOrThrow: jest.Mock; findMany: jest.Mock };
    evidenceFact: { findMany: jest.Mock };
  };
  let debateService: {
    editByHuman: jest.Mock;
    reviseDraft: jest.Mock;
    promoteToOfficial: jest.Mock;
    replaceVerdict: jest.Mock;
  };
  let agentsService: { createDebateAgent: jest.Mock; judge: jest.Mock };
  let stateService: { markApproved: jest.Mock; markCancelled: jest.Mock; resumeFromCheckpoint: jest.Mock };
  let budgetService: { withLlmCall: jest.Mock; withTtsCall: jest.Mock };
  let orchestrator: { runPipeline: jest.Mock; runAudioPipeline: jest.Mock };
  let ttsService: { regenerateSegmentByIndex: jest.Mock };

  beforeEach(async () => {
    prisma = {
      episode: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(episodeWithDebate("PENDING_REVIEW")),
        update: jest.fn(),
      },
      episodeCheckpoint: { findFirst: jest.fn() },
      episodeParticipant: { findFirstOrThrow: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      argument: {
        findUniqueOrThrow: jest.fn(),
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: ARG_ID, debateRound: { id: "round-1", type: "OPENING" } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      evidenceFact: { findMany: jest.fn().mockResolvedValue([]) },
    };
    debateService = {
      editByHuman: jest.fn().mockResolvedValue({ id: ARG_ID, content: "editado" }),
      reviseDraft: jest.fn().mockResolvedValue({ id: ARG_ID, content: "regenerado" }),
      promoteToOfficial: jest.fn().mockResolvedValue({ id: ARG_ID, content: "regenerado", status: "OFFICIAL" }),
      replaceVerdict: jest.fn().mockResolvedValue(NEW_VERDICT_ROW),
    };
    agentsService = {
      createDebateAgent: jest.fn().mockReturnValue({
        argue: jest.fn().mockResolvedValue({ content: "regenerado" }),
        respond: jest.fn().mockResolvedValue({ content: "regenerado", respondsToId: "target-1" }),
      }),
      judge: jest.fn().mockResolvedValue(JUDGE_OUTPUT),
    };
    stateService = {
      markApproved: jest.fn().mockResolvedValue({ id: EPISODE_ID, status: "APPROVED" }),
      markCancelled: jest.fn().mockResolvedValue({ id: EPISODE_ID, status: "CANCELLED" }),
      resumeFromCheckpoint: jest.fn().mockResolvedValue({ id: EPISODE_ID, status: "RESEARCHING" }),
    };
    budgetService = {
      withLlmCall: jest.fn((_episodeId: string, fn: () => Promise<unknown>) => fn()),
      withTtsCall: jest.fn((_episodeId: string, fn: () => Promise<unknown>) => fn()),
    };
    orchestrator = {
      runPipeline: jest.fn().mockResolvedValue(undefined),
      runAudioPipeline: jest.fn().mockResolvedValue(undefined),
    };
    ttsService = { regenerateSegmentByIndex: jest.fn().mockResolvedValue({ id: "new-audio-asset", storageKey: "x" }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EpisodeActionsService,
        // Real, no stub: el mock de Prisma de arriba ya cubre sus queries.
        EpisodeContextService,
        { provide: PrismaService, useValue: prisma },
        { provide: DebateService, useValue: debateService },
        { provide: AgentsService, useValue: agentsService },
        { provide: EpisodeStateService, useValue: stateService },
        { provide: EpisodeBudgetService, useValue: budgetService },
        { provide: EpisodeOrchestratorService, useValue: orchestrator },
        { provide: TtsService, useValue: ttsService },
      ],
    }).compile();

    service = module.get(EpisodeActionsService);
  });

  describe("approve/reject", () => {
    it("approve delega en EpisodeStateService.markApproved y dispara runAudioPipeline fire-and-forget (etapa 2 de TTS)", async () => {
      await service.approve(EPISODE_ID);
      expect(stateService.markApproved).toHaveBeenCalledWith(EPISODE_ID);
      expect(orchestrator.runAudioPipeline).toHaveBeenCalledWith(EPISODE_ID);
    });

    it("reject delega en EpisodeStateService.markCancelled", async () => {
      await service.reject(EPISODE_ID);
      expect(stateService.markCancelled).toHaveBeenCalledWith(EPISODE_ID);
    });
  });

  describe("edit", () => {
    it("en PENDING_REVIEW delega en DebateService.editByHuman", async () => {
      await service.edit(EPISODE_ID, { argumentId: ARG_ID, content: "nuevo texto" });
      expect(debateService.editByHuman).toHaveBeenCalledWith(ARG_ID, "nuevo texto");
    });

    it("fuera de PENDING_REVIEW tira InvalidEpisodeTransitionError", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeWithDebate("DEBATING"));
      await expect(service.edit(EPISODE_ID, { argumentId: ARG_ID, content: "x" })).rejects.toThrow(
        InvalidEpisodeTransitionError
      );
      expect(debateService.editByHuman).not.toHaveBeenCalled();
    });

    // API-14: un argumentId de otro episodio no matchea el where scopeado al
    // debate; findFirstOrThrow tira P2025, que HttpErrorFilter responde 404.
    it("con un argumentId que no es del episodio propaga el P2025 (404 NOT_FOUND) sin editar nada", async () => {
      prisma.argument.findFirstOrThrow.mockRejectedValue(notFound());

      await expect(service.edit(EPISODE_ID, { argumentId: FOREIGN_ARG_ID, content: "x" })).rejects.toMatchObject({ code: "P2025" });

      expect(prisma.argument.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: FOREIGN_ARG_ID, debateRound: { debateId: DEBATE_ID } },
        include: { debateRound: true },
      });
      expect(debateService.editByHuman).not.toHaveBeenCalled();
    });
  });

  describe("regenerate", () => {
    it("OPENING/REBUTTAL: pide argue() nuevo y persiste vía reviseDraft+promoteToOfficial", async () => {
      prisma.argument.findFirstOrThrow.mockResolvedValue({
        id: ARG_ID,
        agentId: AGENT_ID,
        respondsToId: null,
        debateRound: { id: "round-1", type: "OPENING" },
      });
      prisma.episodeParticipant.findFirstOrThrow.mockResolvedValue({
        agentId: AGENT_ID,
        modelProvider: "GOOGLE",
        agent: { role: "ANALYST" },
      });

      const result = await service.regenerate(EPISODE_ID, { argumentId: ARG_ID });

      // AC 2.1: regenerate() sigue siendo una llamada real a LLM, tiene que
      // pasar por el chequeo de presupuesto igual que el resto del pipeline
      // (gap encontrado y corregido en revisión).
      expect(budgetService.withLlmCall).toHaveBeenCalledWith(EPISODE_ID, expect.any(Function));
      expect(agentsService.createDebateAgent).toHaveBeenCalledWith(expect.objectContaining({ id: "ANALYST" }), "GOOGLE");
      expect(debateService.reviseDraft).toHaveBeenCalledWith(ARG_ID, "regenerado");
      expect(debateService.promoteToOfficial).toHaveBeenCalledWith(ARG_ID);
      expect(result.status).toBe("OFFICIAL");
    });

    it("CROSS_EXAMINATION: reconstruye el target desde respondsToId y pide respond()", async () => {
      // API-14: el argumento a regenerar se busca scopeado al episodio
      // (findFirstOrThrow); el target de la réplica, por id (findUniqueOrThrow).
      prisma.argument.findFirstOrThrow.mockResolvedValueOnce({
        id: ARG_ID,
        agentId: AGENT_ID,
        respondsToId: "target-1",
        debateRound: { id: "round-3", type: "CROSS_EXAMINATION" },
      });
      prisma.argument.findUniqueOrThrow.mockResolvedValueOnce({
          id: "target-1",
          agentId: "other-agent",
          content: "argumento original",
          debateRound: { type: "OPENING" },
        });
      prisma.episodeParticipant.findFirstOrThrow.mockResolvedValue({
        agentId: AGENT_ID,
        modelProvider: "GOOGLE",
        agent: { role: "CONTRARIAN" },
      });
      // createDebateAgent está mockeado con mockReturnValue (mismo objeto en
      // cada llamada) — esta referencia es la misma instancia que usa el
      // service internamente.
      const agentInstance = agentsService.createDebateAgent();

      await service.regenerate(EPISODE_ID, { argumentId: ARG_ID });

      expect(agentInstance.respond).toHaveBeenCalledWith(expect.anything(), {
        id: "target-1",
        agentId: "other-agent",
        content: "argumento original",
        roundType: "OPENING",
      });
      expect(debateService.reviseDraft).toHaveBeenCalledWith(ARG_ID, "regenerado");
    });

    it("fuera de PENDING_REVIEW tira InvalidEpisodeTransitionError sin llamar al agente", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeWithDebate("APPROVED"));
      await expect(service.regenerate(EPISODE_ID, { argumentId: ARG_ID })).rejects.toThrow(InvalidEpisodeTransitionError);
      expect(agentsService.createDebateAgent).not.toHaveBeenCalled();
    });

    it("con un argumentId que no es del episodio propaga el P2025 (404 NOT_FOUND) sin llamar al agente ni gastar presupuesto", async () => {
      prisma.argument.findFirstOrThrow.mockRejectedValue(notFound());

      await expect(service.regenerate(EPISODE_ID, { argumentId: FOREIGN_ARG_ID })).rejects.toMatchObject({ code: "P2025" });

      expect(prisma.argument.findFirstOrThrow).toHaveBeenCalledWith({
        where: { id: FOREIGN_ARG_ID, debateRound: { debateId: DEBATE_ID } },
        include: { debateRound: true },
      });
      expect(budgetService.withLlmCall).not.toHaveBeenCalled();
      expect(agentsService.createDebateAgent).not.toHaveBeenCalled();
      expect(debateService.reviseDraft).not.toHaveBeenCalled();
    });
  });

  // Spec 003, API-19 (D17, AC 3.82-3.85).
  describe("regenerateVerdict", () => {
    beforeEach(() => {
      prisma.episodeParticipant.findFirstOrThrow.mockResolvedValue({ agentId: JUDGE_ID, modelProvider: "ANTHROPIC", isJudge: true });
    });

    it("en PENDING_REVIEW llama al juez con el contexto compartido dentro de withLlmCall y reemplaza el veredicto", async () => {
      const result = await service.regenerateVerdict(EPISODE_ID);

      expect(prisma.episodeParticipant.findFirstOrThrow).toHaveBeenCalledWith({ where: { episodeId: EPISODE_ID, isJudge: true } });
      expect(budgetService.withLlmCall).toHaveBeenCalledTimes(1);
      expect(budgetService.withLlmCall).toHaveBeenCalledWith(EPISODE_ID, expect.any(Function));
      // Contexto de EpisodeContextService (real en este spec) y el
      // modelProvider del participante juez.
      expect(agentsService.judge).toHaveBeenCalledWith(
        expect.objectContaining({ topic: "Un trend", officialArguments: [] }),
        "ANTHROPIC"
      );
      expect(debateService.replaceVerdict).toHaveBeenCalledWith(DEBATE_ID, JUDGE_ID, JUDGE_OUTPUT);
      // Shape de debate.verdict, con stale en false.
      expect(result).toEqual({
        id: NEW_VERDICT_ROW.id,
        judgeId: JUDGE_ID,
        content: "Ganó el analista.",
        winnerId: AGENT_ID,
        createdAt: "2026-09-26T10:00:00.000Z",
        stale: false,
      });
    });

    it.each(["DEBATING", "JUDGING", "APPROVED", "REQUIRES_HUMAN_REVIEW", "READY_FOR_RENDER"])(
      "en %s tira 409 sin llamar al juez ni gastar presupuesto",
      async (status) => {
        prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeWithDebate(status));

        await expect(service.regenerateVerdict(EPISODE_ID)).rejects.toThrow(InvalidEpisodeTransitionError);

        expect(budgetService.withLlmCall).not.toHaveBeenCalled();
        expect(agentsService.judge).not.toHaveBeenCalled();
        expect(debateService.replaceVerdict).not.toHaveBeenCalled();
      }
    );

    it("si el estado cambia mientras corre la llamada al juez, tira 409 y no toca el veredicto", async () => {
      agentsService.judge.mockImplementation(async () => {
        // Otra pestaña aprueba el episodio mientras el juez está pensando.
        prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeWithDebate("APPROVED"));
        return JUDGE_OUTPUT;
      });

      await expect(service.regenerateVerdict(EPISODE_ID)).rejects.toMatchObject({
        name: "InvalidEpisodeTransitionError",
        currentStatus: "APPROVED",
        attempted: "regenerate-verdict",
      });
      expect(agentsService.judge).toHaveBeenCalledTimes(1);
      expect(debateService.replaceVerdict).not.toHaveBeenCalled();
    });

    it("sin presupuesto propaga BudgetExceededError (409 USAGE_LIMIT_EXCEEDED) sin llamar al juez ni tocar el veredicto", async () => {
      budgetService.withLlmCall.mockRejectedValue(new BudgetExceededError("USAGE_LIMIT_EXCEEDED", "llmCalls", 38));

      await expect(service.regenerateVerdict(EPISODE_ID)).rejects.toThrow(BudgetExceededError);

      expect(agentsService.judge).not.toHaveBeenCalled();
      expect(debateService.replaceVerdict).not.toHaveBeenCalled();
    });

    it("con la cuota del proveedor agotada propaga el error (503 PROVIDER_QUOTA_EXCEEDED) sin tocar el veredicto", async () => {
      agentsService.judge.mockRejectedValue(new DailyQuotaExceededError("ANTHROPIC", 50));

      await expect(service.regenerateVerdict(EPISODE_ID)).rejects.toThrow(DailyQuotaExceededError);

      expect(debateService.replaceVerdict).not.toHaveBeenCalled();
    });

    it("cualquier otra falla del juez se propaga tal cual (500) sin tocar el veredicto", async () => {
      agentsService.judge.mockRejectedValue(new Error("respuesta inválida del modelo"));

      await expect(service.regenerateVerdict(EPISODE_ID)).rejects.toThrow("respuesta inválida del modelo");

      expect(debateService.replaceVerdict).not.toHaveBeenCalled();
    });
  });

  describe("regenerateAudio", () => {
    it("en READY_FOR_RENDER delega en TtsService.regenerateSegmentByIndex dentro de withTtsCall (AC 2.1)", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeWithDebate("READY_FOR_RENDER"));

      const result = await service.regenerateAudio(EPISODE_ID, { sequenceIndex: 2 });

      expect(budgetService.withTtsCall).toHaveBeenCalledWith(EPISODE_ID, expect.any(Function));
      expect(ttsService.regenerateSegmentByIndex).toHaveBeenCalledWith(EPISODE_ID, 2);
      expect(result).toEqual({ id: "new-audio-asset", storageKey: "x" });
    });

    it("fuera de READY_FOR_RENDER tira InvalidEpisodeTransitionError sin llamar a TtsService", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeWithDebate("PENDING_REVIEW"));

      await expect(service.regenerateAudio(EPISODE_ID, { sequenceIndex: 1 })).rejects.toThrow(InvalidEpisodeTransitionError);
      expect(ttsService.regenerateSegmentByIndex).not.toHaveBeenCalled();
    });
  });

  describe("resume", () => {
    // API-15: resume valida el estado antes de todo lo demás.
    beforeEach(() => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeWithDebate("REQUIRES_HUMAN_REVIEW"));
    });

    it("fuera de REQUIRES_HUMAN_REVIEW tira 409 sin tocar los límites ni transicionar (API-15)", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeWithDebate("PENDING_REVIEW"));
      // El último checkpoint puede ser un USAGE_LIMIT_EXCEEDED ya resuelto:
      // con el orden viejo, el body válido escribía los límites antes del 409.
      prisma.episodeCheckpoint.findFirst.mockResolvedValue({ reason: "USAGE_LIMIT_EXCEEDED", fromState: "DEBATING" });

      await expect(service.resume(EPISODE_ID, { maxLlmCalls: 99 })).rejects.toThrow(InvalidEpisodeTransitionError);

      expect(prisma.episode.update).not.toHaveBeenCalled();
      expect(stateService.resumeFromCheckpoint).not.toHaveBeenCalled();
      expect(orchestrator.runPipeline).not.toHaveBeenCalled();
    });

    it("sin checkpoint activo tira InvalidEpisodeTransitionError", async () => {
      prisma.episodeCheckpoint.findFirst.mockResolvedValue(null);
      await expect(service.resume(EPISODE_ID, {})).rejects.toThrow(InvalidEpisodeTransitionError);
    });

    it("USAGE_LIMIT_EXCEEDED: actualiza los límites del episodio y llama resumeFromCheckpoint", async () => {
      prisma.episodeCheckpoint.findFirst.mockResolvedValue({ reason: "USAGE_LIMIT_EXCEEDED" });

      await service.resume(EPISODE_ID, { maxLlmCalls: 40 });

      expect(prisma.episode.update).toHaveBeenCalledWith({
        where: { id: EPISODE_ID },
        data: { maxLlmCalls: 40 },
      });
      expect(stateService.resumeFromCheckpoint).toHaveBeenCalledWith(EPISODE_ID);
      expect(orchestrator.runPipeline).toHaveBeenCalledWith(EPISODE_ID, undefined);
    });

    it("USAGE_LIMIT_EXCEEDED con body vacío (shape incorrecto para este reason) tira ZodError", async () => {
      prisma.episodeCheckpoint.findFirst.mockResolvedValue({ reason: "USAGE_LIMIT_EXCEEDED" });
      await expect(service.resume(EPISODE_ID, {})).rejects.toThrow(ZodError);
      expect(stateService.resumeFromCheckpoint).not.toHaveBeenCalled();
    });

    it("checkpoint con fromState GENERATING_AUDIO dispara runAudioPipeline en vez de runPipeline (etapa 2 de TTS)", async () => {
      prisma.episodeCheckpoint.findFirst.mockResolvedValue({
        reason: "PROVIDER_QUOTA_EXCEEDED",
        fromState: "GENERATING_AUDIO",
      });

      await service.resume(EPISODE_ID, {});

      expect(stateService.resumeFromCheckpoint).toHaveBeenCalledWith(EPISODE_ID);
      expect(orchestrator.runAudioPipeline).toHaveBeenCalledWith(EPISODE_ID);
      expect(orchestrator.runPipeline).not.toHaveBeenCalled();
    });

    it("INSUFFICIENT_EVIDENCE: propaga manualSources a runPipeline sin tocar límites", async () => {
      prisma.episodeCheckpoint.findFirst.mockResolvedValue({ reason: "INSUFFICIENT_EVIDENCE" });
      const manualSources = [{ url: "https://x.com", title: "t", snippet: "s" }];

      await service.resume(EPISODE_ID, { manualSources });

      expect(prisma.episode.update).not.toHaveBeenCalled();
      expect(orchestrator.runPipeline).toHaveBeenCalledWith(EPISODE_ID, { manualSources });
    });

    it("MAX_REVISIONS_EXCEEDED: body vacío, no toca límites, dispara runPipeline sin opts", async () => {
      prisma.episodeCheckpoint.findFirst.mockResolvedValue({ reason: "MAX_REVISIONS_EXCEEDED" });

      await service.resume(EPISODE_ID, {});

      expect(prisma.episode.update).not.toHaveBeenCalled();
      expect(orchestrator.runPipeline).toHaveBeenCalledWith(EPISODE_ID, undefined);
    });
  });
});
