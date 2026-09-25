import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { DEBATER_PERSONAS } from "../../shared/personas/agents.personas";
import { EpisodeContextService } from "./episode-context.service";

const EPISODE_ID = "11111111-1111-4111-8111-111111111111";
const DEBATE_ID = "22222222-2222-4222-8222-222222222222";
const TOPIC_ID = "33333333-3333-4333-8333-333333333333";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AGENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("EpisodeContextService", () => {
  let service: EpisodeContextService;
  let prisma: {
    episode: { findUniqueOrThrow: jest.Mock };
    evidenceFact: { findMany: jest.Mock };
    argument: { findMany: jest.Mock };
    episodeParticipant: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      episode: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          debateId: DEBATE_ID,
          debate: { topicId: TOPIC_ID, topic: { title: "Un trend" } },
        }),
      },
      evidenceFact: {
        findMany: jest.fn().mockResolvedValue([{ id: "f1", content: "Un hecho", sourceId: "src-1" }]),
      },
      argument: {
        findMany: jest.fn().mockResolvedValue([
          { id: "arg-1", agentId: AGENT_A, content: "Apertura A", debateRound: { type: "OPENING" } },
          { id: "arg-2", agentId: AGENT_B, content: "Apertura B", debateRound: { type: "OPENING" } },
        ]),
      },
      episodeParticipant: {
        findMany: jest.fn().mockResolvedValue([
          { agentId: AGENT_A, isJudge: false, agent: { role: "ANALYST" } },
          { agentId: AGENT_B, isJudge: false, agent: { role: "CONTRARIAN" } },
        ]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [EpisodeContextService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(EpisodeContextService);
  });

  it("arma el DebateContext con el tópico, la Evidence Base, los argumentos OFFICIAL y los debatientes", async () => {
    const context = await service.build(EPISODE_ID);

    expect(context).toEqual({
      topic: "Un trend",
      evidenceBase: { topic: "Un trend", facts: [{ statement: "Un hecho", sourceId: "src-1" }] },
      officialArguments: [
        { id: "arg-1", agentId: AGENT_A, content: "Apertura A", roundType: "OPENING" },
        { id: "arg-2", agentId: AGENT_B, content: "Apertura B", roundType: "OPENING" },
      ],
      participants: [
        { agentId: AGENT_A, personaId: "ANALYST", displayName: DEBATER_PERSONAS.ANALYST.displayName },
        { agentId: AGENT_B, personaId: "CONTRARIAN", displayName: DEBATER_PERSONAS.CONTRARIAN.displayName },
      ],
    });
  });

  it("filtra por el tópico y el debate del episodio, solo OFFICIAL en orden de creación, y sin el juez", async () => {
    await service.build(EPISODE_ID);

    expect(prisma.episode.findUniqueOrThrow).toHaveBeenCalledWith(expect.objectContaining({ where: { id: EPISODE_ID } }));
    expect(prisma.evidenceFact.findMany).toHaveBeenCalledWith({
      where: { source: { researchSession: { topicId: TOPIC_ID } } },
    });
    expect(prisma.argument.findMany).toHaveBeenCalledWith({
      where: { debateRound: { debateId: DEBATE_ID }, status: "OFFICIAL" },
      include: { debateRound: true },
      orderBy: { createdAt: "asc" },
    });
    expect(prisma.episodeParticipant.findMany).toHaveBeenCalledWith({
      where: { episodeId: EPISODE_ID, isJudge: false },
      include: { agent: true },
    });
  });

  it("no cachea: cada llamada vuelve a leer los argumentos OFFICIAL", async () => {
    await service.build(EPISODE_ID);
    prisma.argument.findMany.mockResolvedValueOnce([]);

    const second = await service.build(EPISODE_ID);

    expect(prisma.argument.findMany).toHaveBeenCalledTimes(2);
    expect(second.officialArguments).toEqual([]);
  });
});
