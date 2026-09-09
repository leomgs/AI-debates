import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { EpisodeBudgetService } from "./episode-budget.service";
import { BudgetExceededError } from "./episodes.errors";

const EPISODE_ID = "11111111-1111-4111-8111-111111111111";

describe("EpisodeBudgetService", () => {
  let service: EpisodeBudgetService;
  let prisma: {
    episode: { findUniqueOrThrow: jest.Mock };
    episodeUsage: { updateMany: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      episode: { findUniqueOrThrow: jest.fn() },
      episodeUsage: { updateMany: jest.fn(), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [EpisodeBudgetService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(EpisodeBudgetService);
  });

  describe("withLlmCall", () => {
    it("ejecuta fn cuando el UPDATE atómico afecta una fila (hay margen bajo el límite)", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ id: EPISODE_ID, maxLlmCalls: 25, maxSearchQueries: 5 });
      prisma.episodeUsage.updateMany.mockResolvedValue({ count: 1 });
      const fn = jest.fn().mockResolvedValue("resultado");

      const result = await service.withLlmCall(EPISODE_ID, fn);

      expect(result).toBe("resultado");
      expect(fn).toHaveBeenCalled();
      expect(prisma.episodeUsage.updateMany).toHaveBeenCalledWith({
        where: { episodeId: EPISODE_ID, llmCalls: { lt: 25 } },
        data: { llmCalls: { increment: 1 } },
      });
      expect(prisma.episodeUsage.update).not.toHaveBeenCalled(); // sin decrement, fn() no falló
    });

    it("lanza BudgetExceededError sin ejecutar fn cuando el UPDATE atómico no afecta ninguna fila (límite alcanzado)", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ id: EPISODE_ID, maxLlmCalls: 25, maxSearchQueries: 5 });
      prisma.episodeUsage.updateMany.mockResolvedValue({ count: 0 });
      const fn = jest.fn();

      await expect(service.withLlmCall(EPISODE_ID, fn)).rejects.toThrow(BudgetExceededError);
      expect(fn).not.toHaveBeenCalled();
    });

    it("revierte el incremento (decrement) si fn() lanza, preservando 'solo éxitos consumen presupuesto'", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ id: EPISODE_ID, maxLlmCalls: 25, maxSearchQueries: 5 });
      prisma.episodeUsage.updateMany.mockResolvedValue({ count: 1 });
      const fn = jest.fn().mockRejectedValue(new Error("falló la llamada al LLM"));

      await expect(service.withLlmCall(EPISODE_ID, fn)).rejects.toThrow("falló la llamada al LLM");
      expect(prisma.episodeUsage.update).toHaveBeenCalledWith({
        where: { episodeId: EPISODE_ID },
        data: { llmCalls: { decrement: 1 } },
      });
    });

    it("no tiene condición de carrera bajo llamadas concurrentes: el UPDATE atómico con WHERE lt es la única fuente de verdad, no un valor leído antes", async () => {
      // Regresión del bug real (decision-log.md 2026-09-08): Promise.all
      // sobre varios withLlmCall (processDraft, verificación de claims en
      // paralelo) leía un contador desactualizado antes de la condición de
      // carrera. Acá se simulan 5 llamadas concurrentes contra un mock que
      // solo "tiene margen" para 2 más — el mock de updateMany refleja la
      // semántica real de un UPDATE condicional (cuenta cuántas veces el
      // WHERE seguiría cumpliéndose), no un contador en JS con carrera.
      let remaining = 2;
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ id: EPISODE_ID, maxLlmCalls: 25, maxSearchQueries: 5 });
      prisma.episodeUsage.updateMany.mockImplementation(async () => {
        if (remaining > 0) {
          remaining -= 1;
          return { count: 1 };
        }
        return { count: 0 };
      });
      const fn = jest.fn().mockResolvedValue("ok");

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.withLlmCall(EPISODE_ID, fn))
      );

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(2);
      expect(rejected).toHaveLength(3);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("withSearchRequest", () => {
    it("ejecuta fn cuando el UPDATE atómico afecta una fila", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ id: EPISODE_ID, maxLlmCalls: 25, maxSearchQueries: 5 });
      prisma.episodeUsage.updateMany.mockResolvedValue({ count: 1 });
      const fn = jest.fn().mockResolvedValue("ok");

      await service.withSearchRequest(EPISODE_ID, fn);

      expect(prisma.episodeUsage.updateMany).toHaveBeenCalledWith({
        where: { episodeId: EPISODE_ID, searchRequests: { lt: 5 } },
        data: { searchRequests: { increment: 1 } },
      });
    });

    it("lanza BudgetExceededError en el límite exacto de searchRequests", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ id: EPISODE_ID, maxLlmCalls: 25, maxSearchQueries: 5 });
      prisma.episodeUsage.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.withSearchRequest(EPISODE_ID, jest.fn())).rejects.toThrow(BudgetExceededError);
    });
  });
});
