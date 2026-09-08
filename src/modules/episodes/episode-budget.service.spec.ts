import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { EpisodeBudgetService } from "./episode-budget.service";
import { BudgetExceededError } from "./episodes.errors";

const EPISODE_ID = "11111111-1111-4111-8111-111111111111";

describe("EpisodeBudgetService", () => {
  let service: EpisodeBudgetService;
  let prisma: {
    episode: { findUniqueOrThrow: jest.Mock };
    episodeUsage: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      episode: { findUniqueOrThrow: jest.fn() },
      episodeUsage: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [EpisodeBudgetService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(EpisodeBudgetService);
  });

  describe("withLlmCall", () => {
    it("ejecuta fn e incrementa llmCalls cuando hay margen bajo el límite", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ id: EPISODE_ID, maxLlmCalls: 25, maxSearchQueries: 5 });
      prisma.episodeUsage.findUniqueOrThrow.mockResolvedValue({ episodeId: EPISODE_ID, llmCalls: 10, searchRequests: 0 });
      const fn = jest.fn().mockResolvedValue("resultado");

      const result = await service.withLlmCall(EPISODE_ID, fn);

      expect(result).toBe("resultado");
      expect(fn).toHaveBeenCalled();
      expect(prisma.episodeUsage.update).toHaveBeenCalledWith({
        where: { episodeId: EPISODE_ID },
        data: { llmCalls: { increment: 1 } },
      });
    });

    it("lanza BudgetExceededError sin ejecutar fn cuando llmCalls ya alcanzó el límite", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ id: EPISODE_ID, maxLlmCalls: 25, maxSearchQueries: 5 });
      prisma.episodeUsage.findUniqueOrThrow.mockResolvedValue({ episodeId: EPISODE_ID, llmCalls: 25, searchRequests: 0 });
      const fn = jest.fn();

      await expect(service.withLlmCall(EPISODE_ID, fn)).rejects.toThrow(BudgetExceededError);
      expect(fn).not.toHaveBeenCalled();
      expect(prisma.episodeUsage.update).not.toHaveBeenCalled();
    });

    it("no incrementa el contador si fn() lanza", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ id: EPISODE_ID, maxLlmCalls: 25, maxSearchQueries: 5 });
      prisma.episodeUsage.findUniqueOrThrow.mockResolvedValue({ episodeId: EPISODE_ID, llmCalls: 10, searchRequests: 0 });
      const fn = jest.fn().mockRejectedValue(new Error("falló la llamada al LLM"));

      await expect(service.withLlmCall(EPISODE_ID, fn)).rejects.toThrow("falló la llamada al LLM");
      expect(prisma.episodeUsage.update).not.toHaveBeenCalled();
    });
  });

  describe("withSearchRequest", () => {
    it("ejecuta fn e incrementa searchRequests cuando hay margen", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ id: EPISODE_ID, maxLlmCalls: 25, maxSearchQueries: 5 });
      prisma.episodeUsage.findUniqueOrThrow.mockResolvedValue({ episodeId: EPISODE_ID, llmCalls: 0, searchRequests: 2 });
      const fn = jest.fn().mockResolvedValue("ok");

      await service.withSearchRequest(EPISODE_ID, fn);

      expect(prisma.episodeUsage.update).toHaveBeenCalledWith({
        where: { episodeId: EPISODE_ID },
        data: { searchRequests: { increment: 1 } },
      });
    });

    it("lanza BudgetExceededError en el límite exacto de searchRequests", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ id: EPISODE_ID, maxLlmCalls: 25, maxSearchQueries: 5 });
      prisma.episodeUsage.findUniqueOrThrow.mockResolvedValue({ episodeId: EPISODE_ID, llmCalls: 0, searchRequests: 5 });

      await expect(service.withSearchRequest(EPISODE_ID, jest.fn())).rejects.toThrow(BudgetExceededError);
    });
  });
});
