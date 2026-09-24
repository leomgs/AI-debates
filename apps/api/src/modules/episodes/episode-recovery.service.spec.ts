import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { EpisodeOrchestratorService } from "./episode-orchestrator.service";
import { EpisodeRecoveryService } from "./episode-recovery.service";

describe("EpisodeRecoveryService", () => {
  let service: EpisodeRecoveryService;
  let prisma: { episode: { findMany: jest.Mock } };
  let orchestrator: { runPipeline: jest.Mock; runAudioPipeline: jest.Mock };

  beforeEach(async () => {
    prisma = { episode: { findMany: jest.fn() } };
    orchestrator = {
      runPipeline: jest.fn().mockResolvedValue(undefined),
      runAudioPipeline: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EpisodeRecoveryService,
        { provide: PrismaService, useValue: prisma },
        { provide: EpisodeOrchestratorService, useValue: orchestrator },
      ],
    }).compile();

    service = module.get(EpisodeRecoveryService);
  });

  it("consulta RESEARCHING/DEBATING/JUDGING/GENERATING_AUDIO (RENDERING excluido a propósito, Render no existe todavía)", async () => {
    prisma.episode.findMany.mockResolvedValue([]);
    await service.onApplicationBootstrap();
    expect(prisma.episode.findMany).toHaveBeenCalledWith({
      where: { status: { in: ["RESEARCHING", "DEBATING", "JUDGING", "GENERATING_AUDIO"] } },
    });
  });

  it("dispara runPipeline para cada episodio stuck en las fases de debate", async () => {
    prisma.episode.findMany.mockResolvedValue([
      { id: "ep-1", status: "RESEARCHING" },
      { id: "ep-2", status: "DEBATING" },
      { id: "ep-3", status: "JUDGING" },
    ]);

    await service.onApplicationBootstrap();

    expect(orchestrator.runPipeline).toHaveBeenCalledTimes(3);
    expect(orchestrator.runPipeline).toHaveBeenCalledWith("ep-1");
    expect(orchestrator.runPipeline).toHaveBeenCalledWith("ep-2");
    expect(orchestrator.runPipeline).toHaveBeenCalledWith("ep-3");
    expect(orchestrator.runAudioPipeline).not.toHaveBeenCalled();
  });

  it("dispara runAudioPipeline (no runPipeline) para un episodio stuck en GENERATING_AUDIO (etapa 2 de TTS)", async () => {
    prisma.episode.findMany.mockResolvedValue([{ id: "ep-4", status: "GENERATING_AUDIO" }]);

    await service.onApplicationBootstrap();

    expect(orchestrator.runAudioPipeline).toHaveBeenCalledWith("ep-4");
    expect(orchestrator.runPipeline).not.toHaveBeenCalled();
  });

  it("un rechazo de runPipeline no rompe onApplicationBootstrap (fire-and-forget, logueado)", async () => {
    prisma.episode.findMany.mockResolvedValue([{ id: "ep-1", status: "DEBATING" }]);
    orchestrator.runPipeline.mockRejectedValue(new Error("boom"));

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it("sin episodios stuck, no llama runPipeline", async () => {
    prisma.episode.findMany.mockResolvedValue([]);
    await service.onApplicationBootstrap();
    expect(orchestrator.runPipeline).not.toHaveBeenCalled();
  });
});
