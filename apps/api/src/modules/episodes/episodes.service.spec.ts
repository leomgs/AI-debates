import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ResearchService } from "../research/research.service";
import { DebateService } from "../debate/debate.service";
import { EpisodeOrchestratorService } from "./episode-orchestrator.service";
import { TtsService } from "../tts/tts.service";
import { RenderService } from "../render/render.service";
import { EpisodesService } from "./episodes.service";
import { EpisodeEventsService } from "./episode-events.service";

const TOPIC_ID = "11111111-1111-4111-8111-111111111111";
const DEBATE_ID = "22222222-2222-4222-8222-222222222222";
const EPISODE_ID = "33333333-3333-4333-8333-333333333333";

describe("EpisodesService", () => {
  let service: EpisodesService;
  let prisma: {
    episode: { create: jest.Mock; findMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    episodeUsage: { create: jest.Mock };
    episodeParticipant: { findMany: jest.Mock };
  };
  let research: { createTopic: jest.Mock };
  let debateService: { createDebate: jest.Mock };
  let orchestrator: { runPipeline: jest.Mock };
  let tts: { getOrderedOfficialArguments: jest.Mock; getSignedAudioUrl: jest.Mock; resolveVoiceId: jest.Mock };
  let render: { buildManifest: jest.Mock };
  let events: EpisodeEventsService;

  beforeEach(async () => {
    prisma = {
      episode: { create: jest.fn(), findMany: jest.fn(), findUniqueOrThrow: jest.fn() },
      episodeUsage: { create: jest.fn() },
      episodeParticipant: { findMany: jest.fn() },
    };
    research = { createTopic: jest.fn() };
    debateService = { createDebate: jest.fn() };
    orchestrator = { runPipeline: jest.fn().mockResolvedValue(undefined) };
    tts = { getOrderedOfficialArguments: jest.fn(), getSignedAudioUrl: jest.fn(), resolveVoiceId: jest.fn() };
    render = { buildManifest: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EpisodesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ResearchService, useValue: research },
        { provide: DebateService, useValue: debateService },
        { provide: EpisodeOrchestratorService, useValue: orchestrator },
        { provide: TtsService, useValue: tts },
        { provide: RenderService, useValue: render },
        // Real: no tiene dependencias y es la fuente de pipelineActive.
        EpisodeEventsService,
      ],
    }).compile();

    service = module.get(EpisodesService);
    events = module.get(EpisodeEventsService);
  });

  describe("createEpisode", () => {
    it("crea Topic -> Debate -> Episode -> EpisodeUsage en orden, reusando el mismo string en title/context, y dispara runPipeline sin esperarlo", async () => {
      const now = new Date("2026-09-24T12:00:00.000Z");
      research.createTopic.mockResolvedValue({ id: TOPIC_ID, title: "Un trend", context: "Un trend" });
      debateService.createDebate.mockResolvedValue({ id: DEBATE_ID, topicId: TOPIC_ID });
      prisma.episode.create.mockResolvedValue({
        id: EPISODE_ID,
        debateId: DEBATE_ID,
        title: "Un trend",
        status: "CREATED",
        createdAt: now,
        updatedAt: now,
      });

      const episode = await service.createEpisode("Un trend");

      expect(research.createTopic).toHaveBeenCalledWith("Un trend", "Un trend");
      expect(debateService.createDebate).toHaveBeenCalledWith(TOPIC_ID);
      expect(prisma.episode.create).toHaveBeenCalledWith({ data: { debateId: DEBATE_ID, title: "Un trend" } });
      expect(prisma.episodeUsage.create).toHaveBeenCalledWith({ data: { episodeId: EPISODE_ID } });
      expect(episode.id).toBe(EPISODE_ID);
      // spec 001 — z.date() no es representable en JSON Schema, EpisodeSchema
      // usa z.iso.datetime(): createEpisode serializa el Date real a ISO.
      expect(episode.createdAt).toBe("2026-09-24T12:00:00.000Z");
      expect(episode.updatedAt).toBe("2026-09-24T12:00:00.000Z");
      // Fire-and-forget (decisión D-11): createEpisode ya resolvió arriba sin
      // haber esperado runPipeline — alcanza con que se haya disparado.
      expect(orchestrator.runPipeline).toHaveBeenCalledWith(EPISODE_ID);
    });

    it("un runPipeline rechazado no rompe createEpisode (el catch interno lo absorbe)", async () => {
      research.createTopic.mockResolvedValue({ id: TOPIC_ID, title: "Un trend", context: "Un trend" });
      debateService.createDebate.mockResolvedValue({ id: DEBATE_ID, topicId: TOPIC_ID });
      prisma.episode.create.mockResolvedValue({
        id: EPISODE_ID,
        debateId: DEBATE_ID,
        title: "Un trend",
        status: "CREATED",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
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
    function detailRow() {
      return {
        id: EPISODE_ID,
        status: "DEBATING",
        createdAt: new Date("2026-09-25T10:00:00.000Z"),
        participants: [
          { agentId: "agent-1", isJudge: false, agent: { name: "Analyst", role: "ANALYST" } },
          { agentId: "agent-2", isJudge: false, agent: { name: "Contrarian", role: "CONTRARIAN" } },
          { agentId: "judge-1", isJudge: true, agent: { name: "Judge", role: "JUDGE" } },
        ],
        maxLlmCalls: 25,
        maxSearchQueries: 5,
        maxTtsSegments: 40,
        usage: { llmCalls: 1, searchRequests: 1, ttsRequests: 0, executionTime: 100 },
        checkpoints: [],
        debate: {
          topic: { id: TOPIC_ID, title: "Un trend" },
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
      };
    }

    it("mapea el episodio y solo expone arguments OFFICIAL", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(detailRow());

      const detail = await service.getEpisodeDetail(EPISODE_ID);

      expect(detail.debate.rounds[0].arguments).toHaveLength(1);
      expect(detail.debate.rounds[0].arguments[0].id).toBe("a1");
    });

    // API-1, parte 1 (AC 3.26-3.29): con los participantes el front resuelve
    // el nombre de cada agentId de arguments[] y del veredicto (y cierra
    // API-9: el agente sin argumento aprobado en VALIDATION_INCONSISTENCY).
    it("trae el tópico, createdAt y los participantes con nombre, rol e isJudge", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(detailRow());

      const detail = await service.getEpisodeDetail(EPISODE_ID);

      expect(detail.topic).toEqual({ id: TOPIC_ID, title: "Un trend" });
      expect(detail.createdAt).toBe("2026-09-25T10:00:00.000Z");
      expect(detail.participants).toEqual([
        { agentId: "agent-1", name: "Analyst", role: "ANALYST", isJudge: false },
        { agentId: "agent-2", name: "Contrarian", role: "CONTRARIAN", isJudge: false },
        { agentId: "judge-1", name: "Judge", role: "JUDGE", isJudge: true },
      ]);
      expect(prisma.episode.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: EPISODE_ID },
        include: expect.objectContaining({
          participants: expect.objectContaining({ orderBy: { isJudge: "asc" } }),
          debate: expect.objectContaining({ include: expect.objectContaining({ topic: expect.anything() }) }),
        }),
      });
    });

    // API-12 (AC 3.39): un estado activo sin pipeline en curso es un
    // episodio trabado; el dato sale de EpisodeEventsService, no de la base.
    it("pipelineActive refleja si hay una corrida del pipeline en curso para ese episodio", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(detailRow());

      expect((await service.getEpisodeDetail(EPISODE_ID)).pipelineActive).toBe(false);

      events.begin(EPISODE_ID);
      expect((await service.getEpisodeDetail(EPISODE_ID)).pipelineActive).toBe(true);

      events.complete(EPISODE_ID);
      expect((await service.getEpisodeDetail(EPISODE_ID)).pipelineActive).toBe(false);
    });

    it("pipelineActive es por episodio: una corrida de otro episodio no cuenta", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(detailRow());
      events.begin("otro-episodio");

      expect((await service.getEpisodeDetail(EPISODE_ID)).pipelineActive).toBe(false);
    });
  });

  describe("getManifest (Feature 7)", () => {
    it("arma el input de RenderService desde Prisma+TtsService y resuelve audioUrl por segmento (AC 6.1)", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({
        title: "¿La IA reemplaza programadores?",
        debate: { verdict: { winnerId: "agent-1", content: "Ganó Analyst." } },
      });
      prisma.episodeParticipant.findMany.mockResolvedValue([
        { agent: { id: "agent-1", name: "Analyst", avatarUrl: null, voiceId: { LOCAL: "es_ES-davefx-medium" } } },
      ]);
      tts.resolveVoiceId.mockReturnValue("es_ES-davefx-medium");
      tts.getOrderedOfficialArguments.mockResolvedValue([
        {
          agentId: "agent-1",
          content: "Primer argumento.",
          audioAssetId: "audio-1",
          audioAsset: { durationMs: 4000, subtitles: [{ text: "Primer", startMs: 0, endMs: 500 }] },
        },
      ]);
      render.buildManifest.mockReturnValue({
        episodeId: EPISODE_ID,
        meta: { topic: "¿La IA reemplaza programadores?", durationEstimatedSec: 4 },
        agents: [{ id: "agent-1", name: "Analyst", avatarUrl: null, voiceId: "es_ES-davefx-medium" }],
        timeline: [
          { sequenceIndex: 1, agentId: "agent-1", text: "Primer argumento.", audioAssetId: "audio-1", durationMs: 4000, subtitles: [] },
        ],
        verdict: { winnerAgentId: "agent-1", summary: "Ganó Analyst." },
      });
      tts.getSignedAudioUrl.mockResolvedValue({ url: "/audio-files/ep/audio-1.wav?sig=abc" });

      const manifest = await service.getManifest(EPISODE_ID);

      expect(render.buildManifest).toHaveBeenCalledWith({
        episodeId: EPISODE_ID,
        topic: "¿La IA reemplaza programadores?",
        participants: [{ agentId: "agent-1", name: "Analyst", avatarUrl: null, voiceId: "es_ES-davefx-medium" }],
        officialArguments: [
          {
            agentId: "agent-1",
            content: "Primer argumento.",
            audioAssetId: "audio-1",
            durationMs: 4000,
            subtitles: [{ text: "Primer", startMs: 0, endMs: 500 }],
          },
        ],
        verdict: { winnerId: "agent-1", content: "Ganó Analyst." },
      });
      expect(tts.getSignedAudioUrl).toHaveBeenCalledWith(EPISODE_ID, "audio-1");
      expect(manifest.timeline[0].audioUrl).toBe("/audio-files/ep/audio-1.wav?sig=abc");
    });

    it("verdict null cuando el Debate todavía no tiene Verdict", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ title: "Tema", debate: { verdict: null } });
      prisma.episodeParticipant.findMany.mockResolvedValue([]);
      tts.getOrderedOfficialArguments.mockResolvedValue([]);
      render.buildManifest.mockReturnValue({
        episodeId: EPISODE_ID,
        meta: { topic: "Tema", durationEstimatedSec: 0 },
        agents: [],
        timeline: [],
        verdict: { winnerAgentId: null, summary: "" },
      });

      await service.getManifest(EPISODE_ID);

      expect(render.buildManifest).toHaveBeenCalledWith(expect.objectContaining({ verdict: null }));
    });
  });
});
