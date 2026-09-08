import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { EpisodeParticipantsService } from "./episode-participants.service";

const EPISODE_ID = "11111111-1111-4111-8111-111111111111";
const DEBATE_ID = "22222222-2222-4222-8222-222222222222";

function mockRandomSequence(values: number[]) {
  const spy = jest.spyOn(Math, "random");
  values.forEach((v) => spy.mockImplementationOnce(() => v));
  return spy;
}

describe("EpisodeParticipantsService", () => {
  let service: EpisodeParticipantsService;
  let prisma: { agent: { findFirstOrThrow: jest.Mock }; episodeParticipant: { createMany: jest.Mock } };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    prisma = {
      agent: {
        findFirstOrThrow: jest.fn().mockImplementation(({ where }: { where: { role: string } }) =>
          Promise.resolve({ id: `agent-${where.role}`, role: where.role })
        ),
      },
      episodeParticipant: { createMany: jest.fn() },
    };
    // Por defecto, solo GOOGLE disponible (mismo criterio que env.schema.ts: única requerida)
    config = { get: jest.fn().mockReturnValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EpisodeParticipantsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    service = module.get(EpisodeParticipantsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("elige 2 personas distintas y las persiste como EpisodeParticipant (isJudge: false)", async () => {
    // firstIndex(max=4)=0 -> ANALYST; secondIndex(max=3, sobre el resto)=0 -> CONTRARIAN
    mockRandomSequence([0.01, 0.01, 0.5, 0.5, 0.5]);

    await service.selectParticipants(EPISODE_ID, DEBATE_ID);

    const data = prisma.episodeParticipant.createMany.mock.calls[0][0].data;
    const debaters = data.filter((p: { isJudge: boolean }) => !p.isJudge);
    expect(debaters).toHaveLength(2);
    expect(debaters.map((p: { agentId: string }) => p.agentId)).toEqual(["agent-ANALYST", "agent-CONTRARIAN"]);
  });

  it("asigna al Judge un provider distinto de ambos debatientes cuando hay ≥2 providers disponibles", async () => {
    config.get.mockImplementation((key: string) => (key === "OPENAI_API_KEY" ? "sk-fake" : undefined));
    // personas: cualquiera: 0.01,0.01 -> ANALYST/CONTRARIAN.
    // providerA index(max=2)=0 -> GOOGLE; providerB index(max=2)=0 -> GOOGLE (mismo)
    // judge: free=[OPENAI] (length 1) -> randomIndex(1) siempre 0 sin importar el valor
    mockRandomSequence([0.01, 0.01, 0.1, 0.1, 0.9]);

    await service.selectParticipants(EPISODE_ID, DEBATE_ID);

    const data = prisma.episodeParticipant.createMany.mock.calls[0][0].data;
    const judge = data.find((p: { isJudge: boolean }) => p.isJudge);
    const debaterProviders = data.filter((p: { isJudge: boolean }) => !p.isJudge).map((p: { modelProvider: string }) => p.modelProvider);
    expect(judge.modelProvider).toBe("OPENAI");
    expect(debaterProviders).toEqual(["GOOGLE", "GOOGLE"]);
  });

  it("cae a sortear entre todos los disponibles cuando solo hay 1 provider (fallback documentado)", async () => {
    // config.get siempre undefined -> solo GOOGLE disponible
    mockRandomSequence([0.01, 0.01, 0.5, 0.5, 0.5]);

    await service.selectParticipants(EPISODE_ID, DEBATE_ID);

    const data = prisma.episodeParticipant.createMany.mock.calls[0][0].data;
    expect(data.every((p: { modelProvider: string }) => p.modelProvider === "GOOGLE")).toBe(true);
    expect(prisma.agent.findFirstOrThrow).toHaveBeenCalledWith({ where: { role: "JUDGE" } });
  });
});
