import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ResearchService } from "../research/research.service";
import { DebateService } from "../debate/debate.service";
import { EpisodeOrchestratorService } from "./episode-orchestrator.service";
import { EpisodesService } from "./episodes.service";

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const DEBATE_ID = "22222222-2222-4222-8222-222222222222";
const EPISODE_ID = "33333333-3333-4333-8333-333333333333";

describe("EpisodesService", () => {
  let service: EpisodesService;
  let prisma: {
    episode: { create: jest.Mock; findMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    episodeUsage: { create: jest.Mock };
  };
  let research: { createTopic: jest.Mock };
  let debateService: { createDebate: jest.Mock };
  let orchestrator: { runPipeline: jest.Mock };

  beforeEach(async () => {
    prisma = {
      episode: { create: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
      episodeUsage: { create: jest.fn() },
    };
    research = { createTopic: jest.fn() };
    debateService = { createDebate: jest.fn() };
    orchestrator = { runPipeline: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EpisodesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ResearchService, useValue: research },
        { provide: DebateService, useValue: debateService },
        { provide: EpisodeOrchestratorService, useValue: orchestrator },
      ],
    }).compile();

    service = module.get(EpisodesService);
  });

  describe("createEpisode", () => {
    it("crea Topic -> Debate -> Episode -> EpisodeUsage en orden, reusando el mismo string en title/context, y dispara runPipeline sin esperarlo", async () => {
      research.createTopic.mockResolvedValue({ id: TOPIC_ID, title: "Un trend", context: "Un trend" });
      debateService.createDebate.mockResolvedValue({ id: DEBATE_ID, topicId: TOPIC_ID });
      prisma.episode.create.mockResolvedValue({ id: EPISODE_ID, debateId: DEBATE_ID, title: "Un trend", status: "CREATED" });

      const episode = await service.createEpisode("Un trend");

      expect(research.createTopic).toHaveBeenCalledWith("Un trend", "Un trend");
      expect(debateService.createDebate).toHaveBeenCalledWith(TOPIC_ID);
      expect(prisma.episode.create).toHaveBeenCalledWith({ data: { debateId: DEBATE_ID, title: "Un trend" } });
      expect(prisma.episodeUsage.create).toHaveBeenCalledWith({ data: { episodeId: EPISODE_ID } });
      expect(episode.id).toBe(EPISODE_ID);
      // Fire-and-forget (decisión D-11): createEpisode ya resolvió arriba sin
      // haber esperado runPipeline — alcanza con que se haya disparado.
      expect(orchestrator.runPipeline).toHaveBeenCalledWith(EPISODE_ID);
    });

    it("un runPipeline rechazado no rompe createEpisode (el catch interno lo absorbe)", async () => {
      research.createTopic.mockResolvedValue({ id: TOPIC_ID, title: "Un trend", context: "Un trend" });
      debateService.createDebate.mockResolvedValue({ id: DEBATE_ID, topicId: TOPIC_ID });
      prisma.episode.create.mockResolvedValue({ id: EPISODE_ID, debateId: DEBATE_ID, title: "Un trend", status: "CREATED" });
      orchestrator.runPipeline.mockRejectedValue(new Error("boom"));

      await expect(service.createEpisode("Un trend")).resolves.toMatchObject({ id: EPISODE_ID });
    });
  });

  describe("listEpisodes", () => {
    it("sin filtro, trae todos los episodios", async () => {
      prisma.episode.findMany.mockResolvedValue([]);

      await service.listEpisodes();

      expect(prisma.episode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: undefined })
      );
    });

    it("filtra por status cuando se pasa un CSV válido", async () => {
      prisma.episode.findMany.mockResolvedValue([]);

      await service.listEpisodes("PENDING_REVIEW,REQUIRES_HUMAN_REVIEW");

      expect(prisma.episode.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: { in: ["PENDING_REVIEW", "REQUIRES_HUMAN_REVIEW"] } } })
      );
    });

    it("rechaza un status inválido en el filtro", async () => {
      await expect(service.listEpisodes("NOT_A_STATUS")).rejects.toThrow(BadRequestException);
      expect(prisma.episode.findMany).not.toHaveBeenCalled();
    });
  });

  describe("getEpisodeDetail", () => {
    it("mapea el episodio y solo expone arguments OFFICIAL", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({
        id: EPISODE_ID,
        status: "DEBATING",
        maxLlmCalls: 25,
        maxSearchQueries: 5,
        maxTtsSegments: 40,
        usage: { llmCalls: 1, searchRequests: 1, ttsRequests: 0, executionTime: 100 },
        checkpoints: [],
        debate: {
          rounds: [
            {
              id: "round-1",
              round: 1,
              type: "OPENING",
              arguments: [
                { id: "a1", agentId: "agent-1", content: "oficial", status: "OFFICIAL", origin: "AI_GENERATED", respondsToId: null, createdAt: new Date() },
                { id: "a2", agentId: "agent-1", content: "borrador", status: "DRAFT", origin: "AI_GENERATED", respondsToId: null, createdAt: new Date() },
              ],
            },
          ],
          verdict: null,
        },
      });

      const detail = await service.getEpisodeDetail(EPISODE_ID);

      expect(detail.debate.rounds[0].arguments).toHaveLength(1);
      expect(detail.debate.rounds[0].arguments[0].id).toBe("a1");
    });
  });
});
