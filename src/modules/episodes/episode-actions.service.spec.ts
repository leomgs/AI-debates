import { Test, TestingModule } from "@nestjs/testing";
import { ZodError } from "zod";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { DebateService } from "../debate/debate.service";
import { AgentsService } from "../agents/agents.service";
import { EpisodeStateService } from "./episode-state.service";
import { EpisodeBudgetService } from "./episode-budget.service";
import { EpisodeOrchestratorService } from "./episode-orchestrator.service";
import { TtsService } from "../tts/tts.service";
import { EpisodeActionsService } from "./episode-actions.service";
import { InvalidEpisodeTransitionError } from "./episodes.errors";

const EPISODE_ID = "11111111-1111-4111-8111-111111111111";
const ARG_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";
const DEBATE_ID = "44444444-4444-4444-8444-444444444444";
const TOPIC_ID = "55555555-5555-4555-8555-555555555555";

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
    argument: { findUniqueOrThrow: jest.Mock; findMany: jest.Mock };
    evidenceFact: { findMany: jest.Mock };
  };
  let debateService: {
    editByHuman: jest.Mock;
    reviseDraft: jest.Mock;
    promoteToOfficial: jest.Mock;
  };
  let agentsService: { createDebateAgent: jest.Mock };
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
      argument: { findUniqueOrThrow: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      evidenceFact: { findMany: jest.fn().mockResolvedValue([]) },
    };
    debateService = {
      editByHuman: jest.fn().mockResolvedValue({ id: ARG_ID, content: "editado" }),
      reviseDraft: jest.fn().mockResolvedValue({ id: ARG_ID, content: "regenerado" }),
      promoteToOfficial: jest.fn().mockResolvedValue({ id: ARG_ID, content: "regenerado", status: "OFFICIAL" }),
    };
    agentsService = {
      createDebateAgent: jest.fn().mockReturnValue({
        argue: jest.fn().mockResolvedValue({ content: "regenerado" }),
        respond: jest.fn().mockResolvedValue({ content: "regenerado", respondsToId: "target-1" }),
      }),
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
  });

  describe("regenerate", () => {
    it("OPENING/REBUTTAL: pide argue() nuevo y persiste vía reviseDraft+promoteToOfficial", async () => {
      prisma.argument.findUniqueOrThrow.mockResolvedValue({
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
      prisma.argument.findUniqueOrThrow
        .mockResolvedValueOnce({
          id: ARG_ID,
          agentId: AGENT_ID,
          respondsToId: "target-1",
          debateRound: { id: "round-3", type: "CROSS_EXAMINATION" },
        })
        .mockResolvedValueOnce({
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
