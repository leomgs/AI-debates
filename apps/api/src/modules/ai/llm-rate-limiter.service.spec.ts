import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { LlmRateLimiterService } from "./llm-rate-limiter.service";
import { DailyQuotaExceededError } from "./ai.errors";

describe("LlmRateLimiterService", () => {
  let service: LlmRateLimiterService;
  let prisma: {
    llmRequestLog: {
      create: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      llmRequestLog: {
        create: jest.fn().mockResolvedValue({}),
        count: jest.fn(),
        findMany: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const config = {
      get: jest.fn((key: string) => ({ GOOGLE_RPM_LIMIT: 15, GOOGLE_RPD_LIMIT: 500 })[key]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LlmRateLimiterService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(LlmRateLimiterService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("es no-op (sin chequeo de cupo) para un provider sin límite configurado", async () => {
    await service.acquire("OPENAI");

    expect(prisma.llmRequestLog.count).not.toHaveBeenCalled();
    expect(prisma.llmRequestLog.findMany).not.toHaveBeenCalled();
    expect(prisma.llmRequestLog.create).toHaveBeenCalledWith({ data: { provider: "OPENAI" } });
  });

  it("permite pasar sin esperar cuando GOOGLE está debajo de RPM y RPD", async () => {
    prisma.llmRequestLog.count.mockResolvedValue(0); // RPD
    prisma.llmRequestLog.findMany.mockResolvedValue([]); // RPM

    await service.acquire("GOOGLE");

    expect(prisma.llmRequestLog.create).toHaveBeenCalledWith({ data: { provider: "GOOGLE" } });
  });

  it("lanza DailyQuotaExceededError cuando RPD está al tope, sin llegar a chequear RPM", async () => {
    prisma.llmRequestLog.count.mockResolvedValue(500); // RPD al límite

    await expect(service.acquire("GOOGLE")).rejects.toThrow(DailyQuotaExceededError);

    expect(prisma.llmRequestLog.findMany).not.toHaveBeenCalled();
    expect(prisma.llmRequestLog.create).not.toHaveBeenCalled();
  });

  it("espera a que la request más vieja salga de la ventana de 60s cuando RPM está al tope", async () => {
    jest.useFakeTimers();
    const now = Date.now();
    prisma.llmRequestLog.count.mockResolvedValue(0); // RPD ok
    // 15 requests en los últimos 60s (== límite), la más vieja hace 50s ->
    // faltan 10s para que salga de la ventana.
    prisma.llmRequestLog.findMany.mockResolvedValue(
      Array.from({ length: 15 }, (_, i) => ({ requestedAt: new Date(now - 50_000 + i * 100) }))
    );

    const acquirePromise = service.acquire("GOOGLE");
    await jest.advanceTimersByTimeAsync(10_000);
    await acquirePromise;

    expect(prisma.llmRequestLog.create).toHaveBeenCalledWith({ data: { provider: "GOOGLE" } });
  });

  it("serializa acquire() concurrentes al mismo provider (mutex en memoria)", async () => {
    prisma.llmRequestLog.count.mockResolvedValue(0);
    prisma.llmRequestLog.findMany.mockResolvedValue([]);

    await Promise.all([service.acquire("GOOGLE"), service.acquire("GOOGLE")]);

    expect(prisma.llmRequestLog.create).toHaveBeenCalledTimes(2);
  });
});
