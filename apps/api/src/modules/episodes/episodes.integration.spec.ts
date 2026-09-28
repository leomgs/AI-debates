import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "../../shared/config/env.schema";
import { PrismaModule } from "../../shared/prisma/prisma.module";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ResearchService } from "../research/research.service";
import { InsufficientEvidenceError } from "../research/research.errors";
import { AgentsService } from "../agents/agents.service";
import { FactCheckService } from "../fact-check/fact-check.service";
import { DEBATER_PERSONAS, JUDGE } from "../../shared/personas/agents.personas";
import { EpisodesModule } from "./episodes.module";
import { EpisodeOrchestratorService } from "./episode-orchestrator.service";
import { EpisodeActionsService } from "./episode-actions.service";
import { EpisodeRecoveryService } from "./episode-recovery.service";
import { EpisodesService } from "./episodes.service";
import { DebateService } from "../debate/debate.service";
import { DailyQuotaExceededError } from "../ai/ai.errors";
import { BudgetExceededError, InvalidEpisodeTransitionError } from "./episodes.errors";
import { AUDIO_PROVIDER, AUDIO_STORAGE } from "../tts/tts.tokens";
import { TtsProviderUnavailableError, VoiceNotConfiguredError } from "../tts/tts.errors";
import type { DebateLanguage } from "@prisma/client";
import { ZodError } from "zod";

// coding-rules.md §9 — único módulo con tests de integración multi-módulo
// (todo mockeado en el borde externo: Research/Agents/FactCheck llaman a
// LLMs reales, se reemplazan enteros; DebateService/EpisodeStateService/
// EpisodeParticipantsService/NotificationsService quedan REALES, corren
// contra una DB sqlite de test real — son puramente de persistencia, sin
// llamadas externas, así que probarlos "de mentira" no aportaría nada).
//
// DB de test: archivo sqlite temporal separado de dev.db, migrado una vez en
// beforeAll con `prisma migrate deploy` (aplica las migraciones ya
// existentes, no genera ninguna nueva) y borrado en afterAll. No se usa
// `file::memory:` porque el adapter better-sqlite3 abre una conexión nueva
// por PrismaClient — una DB en memoria no sobreviviría el $connect()
// implícito de PrismaService si algo la reabriera.
const TEST_DB_PATH = join(__dirname, "tmp-episodes-integration.db");
// Hash scrypt válido (formato de shared/crypto/scrypt-password.ts) de una
// contraseña cualquiera: solo tiene que pasar la validación de EnvSchema.
const DUMMY_CURATOR_PASSWORD_HASH =
  "scrypt:16384:8:1:_9YJqs4PlFzDq1FBH0ZrMw:YU4EDvCZx4gNmnpcMxmlvdEbIz694zQ7qmQcgAYqQtCl4ndZ8h6_X67Yb_1s6kxIjr8FGM9HvDxyTMUGz4_mGA";
const TEST_DB_URL = `file:${TEST_DB_PATH.replace(/\\/g, "/")}`;

function fakeArgentAgent(content = "Contenido de prueba generado por el agente.") {
  return {
    argue: jest.fn().mockResolvedValue({ content }),
    respond: jest.fn().mockResolvedValue({ content, respondsToId: "target-placeholder" }),
    amend: jest.fn().mockResolvedValue({ content: `${content} (enmendado)` }),
  };
}

// Cada agente con su voz ES/LOCAL en AgentVoice (ADR 0002), con id
// visiblemente falso (spec 004, D14). Sin estas filas, createEpisode va a
// responder 409 VOICE_NOT_CONFIGURED cuando exista el chequeo del paso 13.6.
const TEST_VOICES = { create: { language: "ES" as const, provider: "LOCAL" as const, voiceId: "voice-test" } };

async function seedAgents(prisma: PrismaService): Promise<void> {
  for (const persona of Object.values(DEBATER_PERSONAS)) {
    await prisma.agent.create({
      data: { name: persona.displayName, role: persona.id, systemPrompt: "prompt de prueba", voices: TEST_VOICES },
    });
  }
  await prisma.agent.create({
    data: { name: JUDGE.displayName, role: JUDGE.id, systemPrompt: "prompt de prueba", voices: TEST_VOICES },
  });
}

async function createTestEpisode(
  prisma: PrismaService,
  overrides: Partial<{ maxRevisionAttempts: number; language: DebateLanguage; rebuttalRounds: number }> = {}
) {
  const topic = await prisma.topic.create({
    data: { title: `Trend de test ${Date.now()}-${Math.random().toString(36).slice(2)}`, context: "contexto de prueba" },
  });
  const debate = await prisma.debate.create({ data: { topicId: topic.id } });
  const episode = await prisma.episode.create({
    data: {
      debateId: debate.id,
      title: topic.title,
      openingRounds: 1,
      rebuttalRounds: 0,
      crossExaminationRounds: 0,
      maxRevisionAttempts: 3,
      ...overrides,
    },
  });
  await prisma.episodeUsage.create({ data: { episodeId: episode.id } });
  return { topic, debate, episode };
}

// Simula el efecto de persistencia real de ResearchService.research() (sin
// pegarle a Tavily/Gemini) — necesario para que hasCompleteResearch() del
// orquestador se comporte igual que con la implementación real, algo
// imprescindible para probar de verdad los escenarios de resume/recovery
// (que dependen de esa idempotencia).
async function persistFakeResearch(prisma: PrismaService, topicId: string, count = 3) {
  const session = await prisma.researchSession.create({
    data: {
      topicId,
      rawOutput: "{}",
      sources: {
        create: Array.from({ length: count }, (_, i) => ({
          title: `Fuente ${i}`,
          url: `https://example.com/fuente-${topicId}-${i}`,
          snippet: `Contenido de prueba ${i}`,
          contentHash: `hash-${topicId}-${i}`,
        })),
      },
    },
    include: { sources: true },
  });
  await prisma.evidenceFact.createMany({
    data: session.sources.map((s) => ({ sourceId: s.id, content: `Hecho extraído de ${s.title}` })),
  });
  return {
    topic: "trend de prueba",
    facts: session.sources.map((s) => ({ statement: `Hecho extraído de ${s.title}`, sourceId: s.id })),
  };
}

describe("EpisodesModule (integración)", () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let orchestrator: EpisodeOrchestratorService;
  let actions: EpisodeActionsService;
  let recovery: EpisodeRecoveryService;
  let episodesService: EpisodesService;
  let debateService: DebateService;

  let researchMock: { createTopic: jest.Mock; research: jest.Mock };
  let agentsMock: { createDebateAgent: jest.Mock; judge: jest.Mock };
  let factCheckMock: { extractClaims: jest.Mock; check: jest.Mock; editorialReview: jest.Mock };
  // Motor de TTS y storage mockeados en el borde (spec 004: los AC de TTS se
  // verifican con lo que recibe el AudioProvider). TtsService es el real.
  let audioProviderMock: { synthesize: jest.Mock };
  let audioStorageMock: { save: jest.Mock; delete: jest.Mock; getSignedUrl: jest.Mock };

  beforeAll(async () => {
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    process.env.DATABASE_URL = TEST_DB_URL;
    process.env.GOOGLE_API_KEY ??= "test-google-api-key";
    process.env.TAVILY_API_KEY ??= "test-tavily-api-key";
    // API-8: EnvSchema exige la credencial del curador (sin defaults). Este
    // test no pasa por HTTP ni por el SessionGuard, así que alcanza con
    // valores dummy válidos.
    process.env.CURATOR_USERNAME ??= "curador-test";
    process.env.CURATOR_PASSWORD_HASH ??= DUMMY_CURATOR_PASSWORD_HASH;
    process.env.SESSION_SECRET ??= "test-session-secret-0123456789abcdef";

    execSync("npx prisma migrate deploy", {
      cwd: join(__dirname, "..", "..", ".."),
      env: process.env,
      stdio: "pipe",
    });

    researchMock = { createTopic: jest.fn(), research: jest.fn() };
    agentsMock = { createDebateAgent: jest.fn(), judge: jest.fn() };
    factCheckMock = { extractClaims: jest.fn(), check: jest.fn(), editorialReview: jest.fn() };
    audioProviderMock = { synthesize: jest.fn() };
    audioStorageMock = { save: jest.fn(), delete: jest.fn(), getSignedUrl: jest.fn() };

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule, EpisodesModule],
    })
      .overrideProvider(ResearchService)
      .useValue(researchMock)
      .overrideProvider(AgentsService)
      .useValue(agentsMock)
      .overrideProvider(FactCheckService)
      .useValue(factCheckMock)
      .overrideProvider(AUDIO_PROVIDER)
      .useValue(audioProviderMock)
      .overrideProvider(AUDIO_STORAGE)
      .useValue(audioStorageMock)
      .compile();

    prisma = moduleRef.get(PrismaService);
    orchestrator = moduleRef.get(EpisodeOrchestratorService);
    actions = moduleRef.get(EpisodeActionsService);
    recovery = moduleRef.get(EpisodeRecoveryService);
    episodesService = moduleRef.get(EpisodesService);
    debateService = moduleRef.get(DebateService);

    await seedAgents(prisma);
  }, 60_000);

  afterAll(async () => {
    await moduleRef?.close();
    try {
      if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
    } catch {
      // Puede quedar lockeado un instante en Windows tras cerrar la
      // conexión — no crítico, es un archivo temporal de test.
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Defaults "todo pasa" — cada test override lo que necesite distinto.
    agentsMock.createDebateAgent.mockImplementation(() => fakeArgentAgent());
    agentsMock.judge.mockImplementation(async (context: { officialArguments: Array<{ agentId: string }> }) => ({
      content: "Veredicto de prueba.",
      winnerAgentId: context.officialArguments[0]?.agentId ?? null,
    }));
    factCheckMock.extractClaims.mockResolvedValue([
      { id: "claim-test", argumentId: "arg-test", statement: "Una afirmación de prueba.", type: "FACTUAL" },
    ]);
    factCheckMock.check.mockResolvedValue({ veracity: "TRUE", analysis: "Verificado.", sourceIds: ["src-test"] });
    factCheckMock.editorialReview.mockResolvedValue({ passed: true });
    audioProviderMock.synthesize.mockResolvedValue({
      audioBuffer: Buffer.from("audio-de-prueba"),
      durationMs: 1000,
      mimeType: "audio/wav",
      subtitles: [],
    });
    audioStorageMock.save.mockResolvedValue(undefined);
    audioStorageMock.delete.mockResolvedValue(undefined);
    audioStorageMock.getSignedUrl.mockImplementation((key: string) => Promise.resolve(`/audio-files/${key}?sig=test`));
  });

  it("pipeline feliz completo: CREATED -> ... -> PENDING_REVIEW, con Argument OFFICIAL y Verdict persistidos", async () => {
    const { topic, episode } = await createTestEpisode(prisma);
    researchMock.research.mockImplementation((topicId: string) => persistFakeResearch(prisma, topicId));

    await orchestrator.runPipeline(episode.id);

    const finalEpisode = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(finalEpisode.status).toBe("PENDING_REVIEW");

    const officialArgs = await prisma.argument.findMany({
      where: { debateRound: { debateId: episode.debateId }, status: "OFFICIAL" },
    });
    expect(officialArgs.length).toBeGreaterThan(0);

    const verdict = await prisma.verdict.findUnique({ where: { debateId: episode.debateId } });
    expect(verdict).not.toBeNull();

    // Confirma que la research falsa quedó realmente persistida para este topic
    // (no solo devuelta) — es la base de la idempotencia probada más abajo.
    const factCount = await prisma.evidenceFact.count({ where: { source: { researchSession: { topicId: topic.id } } } });
    expect(factCount).toBeGreaterThan(0);
  });

  it("InsufficientEvidenceError -> REQUIRES_HUMAN_REVIEW con checkpoint INSUFFICIENT_EVIDENCE", async () => {
    const { episode } = await createTestEpisode(prisma);
    researchMock.research.mockRejectedValue(new InsufficientEvidenceError(1));

    await orchestrator.runPipeline(episode.id);

    const finalEpisode = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(finalEpisode.status).toBe("REQUIRES_HUMAN_REVIEW");

    const checkpoint = await prisma.episodeCheckpoint.findFirst({
      where: { episodeId: episode.id },
      orderBy: { createdAt: "desc" },
    });
    expect(checkpoint?.reason).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("MAX_REVISIONS_EXCEEDED: fact-check falla siempre, agota maxRevisionAttempts -> REQUIRES_HUMAN_REVIEW", async () => {
    const { episode } = await createTestEpisode(prisma, { maxRevisionAttempts: 1 });
    researchMock.research.mockImplementation((topicId: string) => persistFakeResearch(prisma, topicId));
    factCheckMock.check.mockResolvedValue({ veracity: "FALSE", analysis: "Dato incorrecto.", sourceIds: [] });

    await orchestrator.runPipeline(episode.id);

    const finalEpisode = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(finalEpisode.status).toBe("REQUIRES_HUMAN_REVIEW");

    const checkpoint = await prisma.episodeCheckpoint.findFirst({
      where: { episodeId: episode.id },
      orderBy: { createdAt: "desc" },
    });
    expect(checkpoint?.reason).toBe("MAX_REVISIONS_EXCEEDED");
  });

  it("resume exitoso desde INSUFFICIENT_EVIDENCE: sale de REQUIRES_HUMAN_REVIEW y el pipeline avanza", async () => {
    const { episode } = await createTestEpisode(prisma);
    researchMock.research.mockRejectedValueOnce(new InsufficientEvidenceError(1));

    await orchestrator.runPipeline(episode.id);
    let current = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(current.status).toBe("REQUIRES_HUMAN_REVIEW");

    // Segunda llamada (post-resume, con manualSources): esta vez research()
    // "encuentra" evidencia suficiente.
    researchMock.research.mockImplementation((topicId: string) => persistFakeResearch(prisma, topicId));

    const runPipelineSpy = jest.spyOn(orchestrator, "runPipeline");
    await actions.resume(episode.id, { manualSources: [{ url: "https://x.com", title: "t", snippet: "s" }] });
    // resume() dispara runPipeline fire-and-forget — esperamos esa misma
    // promesa (capturada vía spy) para no leer estado a mitad de camino.
    await runPipelineSpy.mock.results[runPipelineSpy.mock.results.length - 1].value;

    current = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(current.status).not.toBe("REQUIRES_HUMAN_REVIEW");
  });

  it("resume con la misma causa dos veces -> FAILED", async () => {
    const { episode } = await createTestEpisode(prisma);
    // Sigue fallando incluso con manualSources — simula que las fuentes
    // manuales tampoco alcanzaron el mínimo.
    researchMock.research.mockRejectedValue(new InsufficientEvidenceError(1));

    await orchestrator.runPipeline(episode.id);
    let current = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(current.status).toBe("REQUIRES_HUMAN_REVIEW");

    const runPipelineSpy = jest.spyOn(orchestrator, "runPipeline");
    await actions.resume(episode.id, { manualSources: [{ url: "https://x.com", title: "t", snippet: "s" }] });
    await runPipelineSpy.mock.results[runPipelineSpy.mock.results.length - 1].value;

    current = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(current.status).toBe("FAILED");

    const checkpoints = await prisma.episodeCheckpoint.findMany({
      where: { episodeId: episode.id },
      orderBy: { createdAt: "asc" },
    });
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints.every((c) => c.reason === "INSUFFICIENT_EVIDENCE")).toBe(true);
  });

  // Escenario más liviano a propósito: no reconstruye un episodio DEBATING
  // con turnos parcialmente completados (requeriría fijar manualmente
  // Argument/DebateRound intermedios) — alcanza con confirmar que
  // EpisodeRecoveryService detecta el episodio "stuck" y que runPipeline()
  // reusado para recovery avanza sin romperse (era exactamente el bug
  // encontrado en revisión: runResearchPhase reventaba con
  // InvalidEpisodeTransitionError al ejecutarse sobre un episodio ya en
  // DEBATING). Research/participantes ya completos de antemano para que la
  // fase de research sea un no-op idempotente real, igual que en producción.
  it("recovery post-caída: retoma un episodio DEBATING sin romper (regresión del bug de runResearchPhase)", async () => {
    const { topic, debate, episode } = await createTestEpisode(prisma);
    await persistFakeResearch(prisma, topic.id);

    const [personaA, personaB] = Object.values(DEBATER_PERSONAS);
    const agentA = await prisma.agent.findFirstOrThrow({ where: { role: personaA.id } });
    const agentB = await prisma.agent.findFirstOrThrow({ where: { role: personaB.id } });
    const judgeAgent = await prisma.agent.findFirstOrThrow({ where: { role: JUDGE.id } });
    await prisma.episodeParticipant.createMany({
      data: [
        { episodeId: episode.id, agentId: agentA.id, modelProvider: "GOOGLE", isJudge: false },
        { episodeId: episode.id, agentId: agentB.id, modelProvider: "GOOGLE", isJudge: false },
        { episodeId: episode.id, agentId: judgeAgent.id, modelProvider: "GOOGLE", isJudge: true },
      ],
    });
    await prisma.episode.update({ where: { id: episode.id }, data: { status: "DEBATING" } });

    const runPipelineSpy = jest.spyOn(orchestrator, "runPipeline");
    await recovery.onApplicationBootstrap();

    const call = runPipelineSpy.mock.calls.find(([id]) => id === episode.id);
    expect(call).toBeDefined();
    await runPipelineSpy.mock.results[runPipelineSpy.mock.calls.indexOf(call!)].value;

    const finalEpisode = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    // No exigimos llegar hasta PENDING_REVIEW acá — el punto de este test es
    // que el pipeline avanzó de DEBATING sin tirar InvalidEpisodeTransitionError,
    // no repetir la cobertura completa del pipeline feliz de más arriba.
    expect(finalEpisode.status).not.toBe("DEBATING");
    expect(debate.id).toBeTruthy(); // silencia unused var, referenciado por claridad del setup
  });

  // Spec 003, API-19 (D17): veredicto desactualizado y "Volver a juzgar",
  // contra la base real (transacción, VerdictHistory, ArgumentHistory y
  // EpisodeUsage de verdad). Solo AgentsService está mockeado.
  describe("API-19: regenerate-verdict y verdict.stale", () => {
    // Deja un episodio en PENDING_REVIEW con el pipeline real. El primer
    // check de fact-check falla una vez, así que el loop de enmienda archiva
    // un ArgumentHistory ANTES del veredicto (no tiene que contar como stale).
    async function episodeInPendingReview() {
      const created = await createTestEpisode(prisma);
      researchMock.research.mockImplementation((topicId: string) => persistFakeResearch(prisma, topicId));
      factCheckMock.check.mockResolvedValueOnce({ veracity: "FALSE", analysis: "Dato incorrecto.", sourceIds: [] });

      await orchestrator.runPipeline(created.episode.id);

      const episode = await prisma.episode.findUniqueOrThrow({ where: { id: created.episode.id } });
      expect(episode.status).toBe("PENDING_REVIEW");
      return created;
    }

    it("stale: false con el historial del loop de enmienda, true tras edit, false tras regenerate-verdict y true de nuevo tras regenerate", async () => {
      const { episode } = await episodeInPendingReview();
      const history = await prisma.argumentHistory.findMany({ where: { argument: { debateRound: { debateId: episode.debateId } } } });
      expect(history.length).toBeGreaterThan(0); // el loop de enmienda sí archivó

      let detail = await episodesService.getEpisodeDetail(episode.id);
      expect(detail.debate.verdict?.stale).toBe(false);
      const firstVerdict = detail.debate.verdict!;
      const argumentId = detail.debate.rounds[0].arguments[0].id;

      await actions.edit(episode.id, { argumentId, content: "Texto corregido por el curador." });
      detail = await episodesService.getEpisodeDetail(episode.id);
      expect(detail.debate.verdict?.stale).toBe(true);

      agentsMock.judge.mockResolvedValueOnce({ content: "Veredicto nuevo.", winnerAgentId: null });
      // Único sleep que queda: isVerdictStale usa >=, así que un edit en el
      // mismo milisegundo que la foto del juez marca stale (el lado seguro).
      // Acá se quiere probar el caso sin cambios posteriores, y sin esta
      // espera el test dependería de que pase 1 ms entre las queries.
      await new Promise((resolve) => setTimeout(resolve, 2));
      const usageBefore = await prisma.episodeUsage.findUniqueOrThrow({ where: { episodeId: episode.id } });
      const replaced = await actions.regenerateVerdict(episode.id);

      expect(replaced).toMatchObject({ content: "Veredicto nuevo.", winnerId: null, stale: false });
      expect(replaced.id).not.toBe(firstVerdict.id); // Verdict.id cambia en cada vuelta
      const usageAfter = await prisma.episodeUsage.findUniqueOrThrow({ where: { episodeId: episode.id } });
      expect(usageAfter.llmCalls).toBe(usageBefore.llmCalls + 1);

      detail = await episodesService.getEpisodeDetail(episode.id);
      expect(detail.debate.verdict).toEqual(replaced);

      // El reemplazado quedó archivado tal cual, con su fecha de emisión.
      const archived = await prisma.verdictHistory.findMany({ where: { debateId: episode.debateId } });
      expect(archived).toHaveLength(1);
      expect(archived[0]).toMatchObject({
        judgeId: firstVerdict.judgeId,
        content: firstVerdict.content,
        winnerId: firstVerdict.winnerId,
      });
      expect(archived[0].issuedAt.toISOString()).toBe(firstVerdict.createdAt);
      expect(await prisma.verdict.count({ where: { debateId: episode.debateId } })).toBe(1);

      // Un regenerate posterior vuelve a marcarlo (AC 3.81, edge case
      // "Editar después de volver a juzgar").
      await actions.regenerate(episode.id, { argumentId });
      detail = await episodesService.getEpisodeDetail(episode.id);
      expect(detail.debate.verdict?.stale).toBe(true);
    });

    it("si el juez falla, el veredicto queda intacto, no se archiva nada y el cupo se devuelve", async () => {
      const { episode } = await episodeInPendingReview();
      const verdictBefore = await prisma.verdict.findUniqueOrThrow({ where: { debateId: episode.debateId } });
      const usageBefore = await prisma.episodeUsage.findUniqueOrThrow({ where: { episodeId: episode.id } });
      agentsMock.judge.mockRejectedValueOnce(new DailyQuotaExceededError("GOOGLE", 500));

      await expect(actions.regenerateVerdict(episode.id)).rejects.toThrow(DailyQuotaExceededError);

      expect(await prisma.verdict.findUniqueOrThrow({ where: { debateId: episode.debateId } })).toEqual(verdictBefore);
      expect(await prisma.verdictHistory.count({ where: { debateId: episode.debateId } })).toBe(0);
      const usageAfter = await prisma.episodeUsage.findUniqueOrThrow({ where: { episodeId: episode.id } });
      expect(usageAfter.llmCalls).toBe(usageBefore.llmCalls);
    });

    it("sin presupuesto tira BudgetExceededError sin llamar al juez y con el veredicto intacto", async () => {
      const { episode } = await episodeInPendingReview();
      const usage = await prisma.episodeUsage.findUniqueOrThrow({ where: { episodeId: episode.id } });
      await prisma.episode.update({ where: { id: episode.id }, data: { maxLlmCalls: usage.llmCalls } });
      const verdictBefore = await prisma.verdict.findUniqueOrThrow({ where: { debateId: episode.debateId } });
      agentsMock.judge.mockClear();

      await expect(actions.regenerateVerdict(episode.id)).rejects.toThrow(BudgetExceededError);

      expect(agentsMock.judge).not.toHaveBeenCalled();
      expect(await prisma.verdict.findUniqueOrThrow({ where: { debateId: episode.debateId } })).toEqual(verdictBefore);
      expect(await prisma.verdictHistory.count({ where: { debateId: episode.debateId } })).toBe(0);
    });

    it("si el episodio se aprueba mientras el juez piensa, 409 y el veredicto queda como estaba", async () => {
      const { episode } = await episodeInPendingReview();
      const verdictBefore = await prisma.verdict.findUniqueOrThrow({ where: { debateId: episode.debateId } });
      agentsMock.judge.mockImplementationOnce(async () => {
        await prisma.episode.update({ where: { id: episode.id }, data: { status: "APPROVED" } });
        return { content: "Llega tarde.", winnerAgentId: null };
      });

      await expect(actions.regenerateVerdict(episode.id)).rejects.toThrow(InvalidEpisodeTransitionError);

      expect(await prisma.verdict.findUniqueOrThrow({ where: { debateId: episode.debateId } })).toEqual(verdictBefore);
      expect(await prisma.verdictHistory.count({ where: { debateId: episode.debateId } })).toBe(0);
    });

    // Review F2-2: el juez evalúa la foto de context.build(), y la llamada
    // puede esperar ~90 s al limitador de RPM. Un edit hecho en otra pestaña
    // en esa ventana no está en lo que evaluó el juez: el veredicto nuevo
    // tiene que salir desactualizado.
    it("un edit hecho mientras el juez corre deja el veredicto nuevo como desactualizado", async () => {
      const { episode } = await episodeInPendingReview();
      const detail = await episodesService.getEpisodeDetail(episode.id);
      const argumentId = detail.debate.rounds[0].arguments[0].id;
      agentsMock.judge.mockImplementationOnce(async () => {
        await actions.edit(episode.id, { argumentId, content: "Editado en otra pestaña mientras el juez pensaba." });
        return { content: "Veredicto sobre la foto vieja.", winnerAgentId: null };
      });

      const replaced = await actions.regenerateVerdict(episode.id);

      expect(replaced.stale).toBe(true);
      expect((await episodesService.getEpisodeDetail(episode.id)).debate.verdict).toMatchObject({ id: replaced.id, stale: true });
    });

    // Review F2-2 (entrada 35): la ventana que quedaba era un juez que toma
    // su foto ENTRE las dos escrituras de una acción que archiva en
    // ArgumentHistory. Se la fuerza sin sleeps: la transacción de la acción
    // se frena antes de su segunda escritura hasta que el juez de
    // regenerate-verdict ya leyó el contexto, y el juez no contesta hasta que
    // la acción terminó. Con update → historial, esa foto ya ve la versión
    // nueva y el historial es posterior a judgedFrom, así que sale
    // stale: true (el lado seguro). Con el orden inverso, el juez leería la
    // versión vieja y el veredicto saldría stale: false.
    //
    // Devuelve el contexto que recibió el juez y el veredicto resultante.
    async function judgeBetweenTheTwoWrites(episodeId: string, action: () => Promise<unknown>) {
      type JudgeContext = { officialArguments: Array<{ content: string }> };
      let judgeSawContext!: (context: JudgeContext) => void;
      const judgeContext = new Promise<JudgeContext>((resolve) => (judgeSawContext = resolve));
      let finishAction!: () => void;
      const actionFinished = new Promise<void>((resolve) => (finishAction = resolve));
      agentsMock.judge.mockImplementationOnce(async (context: JudgeContext) => {
        judgeSawContext(context);
        await actionFinished;
        return { content: "Veredicto con foto en el medio de la acción.", winnerAgentId: null };
      });

      let regenerating: ReturnType<EpisodeActionsService["regenerateVerdict"]> | undefined;
      const realTransaction = prisma.$transaction.bind(prisma) as (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
      const spy = jest.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
        realTransaction((tx) => {
          // Cuenta las escrituras de Argument/ArgumentHistory y, antes de la
          // segunda, arranca regenerate-verdict y espera a que el juez tenga
          // su contexto. Si regenerateVerdict termina sin llamar al juez, el
          // test falla con un error claro en vez de colgarse.
          let writes = 0;
          const pauseBeforeSecondWrite = (delegate: Record<string, unknown>) =>
            new Proxy(delegate, {
              get(target, prop) {
                const value = target[prop as string];
                if (typeof value !== "function") return value;
                if (prop !== "update" && prop !== "create") return value.bind(target);
                return async (args: unknown) => {
                  writes += 1;
                  if (writes === 2) {
                    regenerating = actions.regenerateVerdict(episodeId);
                    const endedWithoutJudge = regenerating.then(() => {
                      throw new Error("regenerateVerdict terminó sin llamar al juez");
                    });
                    endedWithoutJudge.catch(() => undefined); // el perdedor de la carrera no queda sin manejar
                    await Promise.race([judgeContext, endedWithoutJudge]);
                  }
                  return value.call(target, args);
                };
              },
            });
          const client = tx as Record<string, Record<string, unknown>>;
          return fn(
            new Proxy(client, {
              get(target, prop) {
                if (prop === "argument" || prop === "argumentHistory") return pauseBeforeSecondWrite(target[prop]);
                return target[prop as string];
              },
            })
          );
        })) as never);

      try {
        await action();
      } finally {
        spy.mockRestore();
        finishAction();
      }
      expect(regenerating).toBeDefined();
      const verdict = await regenerating!;
      return { context: await judgeContext, verdict };
    }

    it("un juez que toma su foto entre las dos escrituras del edit nunca lee el texto viejo sin quedar desactualizado", async () => {
      const { episode } = await episodeInPendingReview();
      const detail = await episodesService.getEpisodeDetail(episode.id);
      const argumentId = detail.debate.rounds[0].arguments[0].id;
      const newText = "Editado justo mientras el juez tomaba su foto.";

      const { context, verdict } = await judgeBetweenTheTwoWrites(episode.id, () =>
        actions.edit(episode.id, { argumentId, content: newText })
      );

      expect(context.officialArguments.map((a) => a.content)).toContain(newText);
      expect(verdict.stale).toBe(true);
    });

    // Review F2-2: regenerate sobre un argumento que no es OFFICIAL
    // (findArgumentInEpisode no filtra status). El juez solo lee OFFICIAL,
    // así que la promoción tiene que ir en el mismo update, antes del
    // historial: con reviseDraft + promoteToOfficial por separado, un juez
    // entre el historial y el promote no veía el argumento y daba stale: false.
    it("regenerate sobre un argumento no OFFICIAL: un juez entre las dos escrituras ya lo ve OFFICIAL y queda desactualizado", async () => {
      const { episode } = await episodeInPendingReview();
      const detail = await episodesService.getEpisodeDetail(episode.id);
      const argumentId = detail.debate.rounds[0].arguments[0].id;
      await prisma.argument.update({ where: { id: argumentId }, data: { status: "REJECTED" } });
      const newText = "Regenerado por el agente a pedido del curador.";
      agentsMock.createDebateAgent.mockImplementationOnce(() => fakeArgentAgent(newText));

      const { context, verdict } = await judgeBetweenTheTwoWrites(episode.id, () => actions.regenerate(episode.id, { argumentId }));

      expect(context.officialArguments.map((a) => a.content)).toContain(newText);
      expect(verdict.stale).toBe(true);
      const regenerated = await prisma.argument.findUniqueOrThrow({ where: { id: argumentId } });
      expect(regenerated).toMatchObject({ content: newText, status: "OFFICIAL", origin: "AI_GENERATED" });
    });

    // Review F2-2: con @prisma/adapter-better-sqlite3 las transacciones
    // interactivas comparten la única conexión (atomicidad sin aislamiento).
    // Dos "Volver a juzgar" a la vez no pueden dejar dos veredictos ni perder
    // el archivo: 1 Verdict y 2 filas en VerdictHistory.
    it("dos regenerate-verdict en paralelo terminan con 1 veredicto y 2 archivados, sin errores", async () => {
      const { episode } = await episodeInPendingReview();
      agentsMock.judge
        .mockResolvedValueOnce({ content: "Veredicto A.", winnerAgentId: null })
        .mockResolvedValueOnce({ content: "Veredicto B.", winnerAgentId: null });

      const results = await Promise.all([actions.regenerateVerdict(episode.id), actions.regenerateVerdict(episode.id)]);

      const verdicts = await prisma.verdict.findMany({ where: { debateId: episode.debateId } });
      expect(verdicts).toHaveLength(1);
      expect(results.map((r) => r.id)).toContain(verdicts[0].id);
      expect(await prisma.verdictHistory.count({ where: { debateId: episode.debateId } })).toBe(2);
    });

    it("replaceVerdict es atómico: si crear el nuevo falla, el vigente sigue y no queda archivo", async () => {
      const { episode } = await episodeInPendingReview();
      const verdictBefore = await prisma.verdict.findUniqueOrThrow({ where: { debateId: episode.debateId } });

      // judgeId inexistente: la FK Verdict.judgeId → Agent falla en el
      // create, después de que ya se archivó y borró el vigente.
      await expect(
        debateService.replaceVerdict(episode.debateId, "00000000-0000-4000-8000-000000000000", { content: "x", winnerAgentId: null }, new Date())
      ).rejects.toThrow();

      expect(await prisma.verdict.findUniqueOrThrow({ where: { debateId: episode.debateId } })).toEqual(verdictBefore);
      expect(await prisma.verdictHistory.count({ where: { debateId: episode.debateId } })).toBe(0);
    });
  });

  // Spec 004, paso 13.6 (D14-D17). La base de este archivo tiene, como la
  // que deja el seed del MVP, solo voces ES (seedAgents). Las filas EN/PT que
  // cargan algunos tests son de prueba, con ids visiblemente ficticios (D14),
  // y se borran después de cada test: nunca van al seed.
  describe("spec 004: voces por idioma y VOICE_NOT_CONFIGURED", () => {
    const CANDIDATE_ROLES = [...Object.values(DEBATER_PERSONAS).map((p) => p.id), JUDGE.id];

    // Id ficticio por agente e idioma (D14): test-en-analyst, test-pt-judge...
    function testVoiceId(language: DebateLanguage, role: string): string {
      return `test-${language.toLowerCase()}-${role.toLowerCase()}`;
    }

    async function loadTestVoices(language: DebateLanguage, roles: readonly string[] = CANDIDATE_ROLES): Promise<void> {
      for (const role of roles) {
        const agent = await prisma.agent.findFirstOrThrow({ where: { role } });
        await prisma.agentVoice.create({
          data: { agentId: agent.id, language, provider: "LOCAL", voiceId: testVoiceId(language, role) },
        });
      }
    }

    async function countCreationRows() {
      const [topics, debates, episodes, usages] = await Promise.all([
        prisma.topic.count(),
        prisma.debate.count(),
        prisma.episode.count(),
        prisma.episodeUsage.count(),
      ]);
      return { topics, debates, episodes, usages };
    }

    // Episodio en PENDING_REVIEW con el pipeline real, OPENING + REBUTTAL
    // (4 segmentos, 2 por debatiente, alternados).
    async function episodeReadyForAudio(language: DebateLanguage) {
      const created = await createTestEpisode(prisma, { language, rebuttalRounds: 1 });
      researchMock.research.mockImplementation((topicId: string) => persistFakeResearch(prisma, topicId));
      await orchestrator.runPipeline(created.episode.id);
      expect((await prisma.episode.findUniqueOrThrow({ where: { id: created.episode.id } })).status).toBe("PENDING_REVIEW");
      return created;
    }

    // approve y resume disparan runAudioPipeline sin await: se espera esa
    // promesa (vía spy) para no leer el estado a mitad de camino.
    async function awaitAudioPipeline(trigger: () => Promise<unknown>): Promise<void> {
      const spy = jest.spyOn(orchestrator, "runAudioPipeline");
      try {
        await trigger();
        await spy.mock.results[spy.mock.results.length - 1].value;
      } finally {
        spy.mockRestore();
      }
    }

    async function segmentsWithAgent(debateId: string) {
      return prisma.argument.findMany({
        where: { debateRound: { debateId }, status: "OFFICIAL" },
        include: { agent: true, audioAsset: true },
        orderBy: { createdAt: "asc" },
      });
    }

    async function lastCheckpoints(episodeId: string) {
      return prisma.episodeCheckpoint.findMany({ where: { episodeId }, orderBy: { createdAt: "asc" } });
    }

    afterEach(async () => {
      await prisma.agentVoice.deleteMany({ where: { language: { not: "ES" } } });
    });

    // AC 4.29 (parte de servicio; la HTTP está en test/episode-language.e2e-spec.ts) y AC 4.4.
    describe("createEpisode (D15, AC 4.4 y 4.29)", () => {
      let runPipelineSpy: jest.SpyInstance;

      beforeEach(() => {
        researchMock.createTopic.mockImplementation((title: string, context: string) =>
          prisma.topic.create({ data: { title, context } })
        );
        // El pipeline en background no es lo que se prueba acá.
        runPipelineSpy = jest.spyOn(orchestrator, "runPipeline").mockResolvedValue(undefined);
      });

      afterEach(() => {
        runPipelineSpy.mockRestore();
      });

      it.each(["EN", "PT"] as const)(
        "con solo voces ES, %s tira VoiceNotConfiguredError con el idioma, LOCAL y los 5 candidatos, sin crear filas",
        async (language) => {
          const before = await countCreationRows();

          const error = await episodesService.createEpisode(`Trend ${language} ${Date.now()}`, language).catch((err: unknown) => err);

          expect(error).toBeInstanceOf(VoiceNotConfiguredError);
          const voiceError = error as VoiceNotConfiguredError;
          expect(voiceError.language).toBe(language);
          expect(voiceError.provider).toBe("LOCAL");
          expect(voiceError.agents).toHaveLength(5);
          expect(voiceError.message).toContain(`idioma ${language}`);
          expect(voiceError.message).toContain('"LOCAL"');
          for (const role of CANDIDATE_ROLES) expect(voiceError.message).toContain(`(${role})`);

          expect(await countCreationRows()).toEqual(before);
          expect(researchMock.createTopic).not.toHaveBeenCalled();
          expect(runPipelineSpy).not.toHaveBeenCalled();
        }
      );

      it("con ES explícito o sin idioma crea el episodio normalmente, en ES", async () => {
        const before = await countCreationRows();

        const explicit = await episodesService.createEpisode(`Trend ES ${Date.now()}`, "ES");
        const implicit = await episodesService.createEpisode(`Trend sin idioma ${Date.now()}`);

        for (const created of [explicit, implicit]) {
          expect((await prisma.episode.findUniqueOrThrow({ where: { id: created.id } })).language).toBe("ES");
        }
        expect(await countCreationRows()).toEqual({
          topics: before.topics + 2,
          debates: before.debates + 2,
          episodes: before.episodes + 2,
          usages: before.usages + 2,
        });
      });

      // D20: cargar las voces de un idioma lo habilita sin otro cambio.
      it("con voces EN de prueba para los 5 candidatos, EN crea el episodio en EN", async () => {
        await loadTestVoices("EN");

        const created = await episodesService.createEpisode(`Trend EN habilitado ${Date.now()}`, "EN");

        expect((await prisma.episode.findUniqueOrThrow({ where: { id: created.id } })).language).toBe("EN");
      });

      it("si falta la voz de un solo candidato, el error nombra solo a ese agente", async () => {
        await loadTestVoices("EN", CANDIDATE_ROLES.filter((role) => role !== "PROVOCATEUR"));
        const before = await countCreationRows();

        const error = await episodesService.createEpisode(`Trend ${Date.now()}`, "EN").catch((err: unknown) => err);

        expect(error).toBeInstanceOf(VoiceNotConfiguredError);
        expect((error as VoiceNotConfiguredError).agents).toEqual([expect.stringContaining("(PROVOCATEUR)")]);
        expect(await countCreationRows()).toEqual(before);
      });

      it("si falta la fila Agent de un rol candidato, cuenta como sin voz y el error lo nombra por su rol", async () => {
        const diplomat = await prisma.agent.findFirstOrThrow({ where: { role: "DIPLOMAT" } });
        await prisma.agent.update({ where: { id: diplomat.id }, data: { role: "RETIRADO" } });
        try {
          const before = await countCreationRows();

          const error = await episodesService.createEpisode(`Trend ${Date.now()}`, "ES").catch((err: unknown) => err);

          expect(error).toBeInstanceOf(VoiceNotConfiguredError);
          expect((error as VoiceNotConfiguredError).agents).toEqual(["rol DIPLOMAT (sin fila Agent)"]);
          expect(await countCreationRows()).toEqual(before);
        } finally {
          await prisma.agent.update({ where: { id: diplomat.id }, data: { role: "DIPLOMAT" } });
        }
      });
    });

    // AC 4.14 y D17: la voz que recibe el AudioProvider es la del idioma del
    // episodio y del agente; AudioAsset.voiceId la guarda y el manifest la
    // informa aunque después cambie AgentVoice.
    it("fase de audio EN: cada segmento sale con la voz EN/LOCAL de su agente y AudioAsset.voiceId la guarda", async () => {
      await loadTestVoices("EN");
      const { episode } = await episodeReadyForAudio("EN");

      await awaitAudioPipeline(() => actions.approve(episode.id));

      expect((await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } })).status).toBe("READY_FOR_RENDER");
      const segments = await segmentsWithAgent(episode.debateId);
      expect(segments).toHaveLength(4);
      expect(audioProviderMock.synthesize).toHaveBeenCalledTimes(4);
      segments.forEach((segment, i) => {
        const expectedVoice = testVoiceId("EN", segment.agent.role!);
        expect(audioProviderMock.synthesize).toHaveBeenNthCalledWith(i + 1, segment.content, expectedVoice);
        expect(segment.audioAsset?.voiceId).toBe(expectedVoice);
      });
    });

    it("regenerate-audio usa la voz del idioma del episodio (AC 4.14) y, sin esa voz, 409 sin tocar el segmento (AC 4.15)", async () => {
      await loadTestVoices("PT");
      const { episode } = await episodeReadyForAudio("PT");
      await awaitAudioPipeline(() => actions.approve(episode.id));
      audioProviderMock.synthesize.mockClear();

      const [first] = await segmentsWithAgent(episode.debateId);
      const regenerated = await actions.regenerateAudio(episode.id, { sequenceIndex: 1 });
      expect(audioProviderMock.synthesize).toHaveBeenCalledWith(first.content, testVoiceId("PT", first.agent.role!));
      expect(regenerated.voiceId).toBe(testVoiceId("PT", first.agent.role!));

      // Se borra la voz PT de ese agente: el segmento queda como estaba y el
      // cupo de TTS se devuelve.
      await prisma.agentVoice.delete({
        where: { agentId_language_provider: { agentId: first.agentId, language: "PT", provider: "LOCAL" } },
      });
      audioProviderMock.synthesize.mockClear();
      const usageBefore = await prisma.episodeUsage.findUniqueOrThrow({ where: { episodeId: episode.id } });

      await expect(actions.regenerateAudio(episode.id, { sequenceIndex: 1 })).rejects.toThrow(VoiceNotConfiguredError);

      expect(audioProviderMock.synthesize).not.toHaveBeenCalled();
      const [after] = await segmentsWithAgent(episode.debateId);
      expect(after.audioAssetId).toBe(regenerated.id);
      expect(await prisma.audioAsset.findUnique({ where: { id: regenerated.id } })).not.toBeNull();
      expect((await prisma.episodeUsage.findUniqueOrThrow({ where: { episodeId: episode.id } })).ttsRequests).toBe(usageBefore.ttsRequests);
    });

    // D17 revisado, AC 4.16 (paso 13.7): el manifest informa la voz guardada
    // en AudioAsset.voiceId (la del primer segmento del agente) o null, y
    // nunca lee AgentVoice. Así, cambiar o borrar una voz del seed no altera
    // ni rompe el manifest de un episodio ya sintetizado. Episodio EN con
    // voces de prueba distintas por rol, para distinguir cada voz.
    describe("manifest de un episodio READY_FOR_RENDER (D17 revisado, AC 4.16)", () => {
      async function readyForRender() {
        await loadTestVoices("EN");
        const created = await episodeReadyForAudio("EN");
        await awaitAudioPipeline(() => actions.approve(created.episode.id));
        expect((await prisma.episode.findUniqueOrThrow({ where: { id: created.episode.id } })).status).toBe("READY_FOR_RENDER");
        const participants = await prisma.episodeParticipant.findMany({ where: { episodeId: created.episode.id } });
        const judgeId = participants.find((p) => p.isJudge)!.agentId;
        const debaterIds = participants.filter((p) => !p.isJudge).map((p) => p.agentId);
        return { ...created, judgeId, debaterIds };
      }

      it("el juez figura en agents con voiceId null, cada debatiente con la voz de sus assets y meta.language es el del episodio", async () => {
        const { episode, judgeId, debaterIds } = await readyForRender();

        const manifest = await episodesService.getManifest(episode.id);

        expect(manifest.meta.language).toBe("EN");
        expect(manifest.agents).toHaveLength(3);
        expect(manifest.agents.find((a) => a.id === judgeId)?.voiceId).toBeNull();
        for (const debaterId of debaterIds) {
          const agent = await prisma.agent.findUniqueOrThrow({ where: { id: debaterId } });
          expect(manifest.agents.find((a) => a.id === debaterId)?.voiceId).toBe(testVoiceId("EN", agent.role!));
        }
      });

      it("cambiar la voz del juez y la de un debatiente en AgentVoice no altera el manifest", async () => {
        const { episode, judgeId, debaterIds } = await readyForRender();
        const before = await episodesService.getManifest(episode.id);

        await prisma.agentVoice.updateMany({
          where: { agentId: { in: [judgeId, debaterIds[0]] }, language: "EN" },
          data: { voiceId: "test-en-voz-cambiada" },
        });

        const after = await episodesService.getManifest(episode.id);
        expect(after.agents).toEqual(before.agents);
        expect(after.agents.map((a) => a.voiceId)).not.toContain("test-en-voz-cambiada");
      });

      it("borrar todas las filas AgentVoice del juez deja el manifest igual, sin VOICE_NOT_CONFIGURED", async () => {
        const { episode, judgeId } = await readyForRender();
        const before = await episodesService.getManifest(episode.id);
        const judgeVoices = await prisma.agentVoice.findMany({ where: { agentId: judgeId } });

        await prisma.agentVoice.deleteMany({ where: { agentId: judgeId } });
        try {
          const after = await episodesService.getManifest(episode.id);
          expect(after).toEqual(before);
        } finally {
          // Las filas ES son del setup compartido (seedAgents): se restauran.
          await prisma.agentVoice.createMany({ data: judgeVoices.filter((v) => v.language === "ES") });
        }
      });

      // Assets anteriores a la migración que quedaron sin voiceId (pregunta B).
      it("un debatiente cuyos assets no tienen voiceId figura con null, aunque tenga voz en AgentVoice", async () => {
        const { episode, debaterIds } = await readyForRender();
        const [debaterId, otherId] = debaterIds;
        const segments = await segmentsWithAgent(episode.debateId);
        await prisma.audioAsset.updateMany({
          where: { id: { in: segments.filter((s) => s.agentId === debaterId).map((s) => s.audioAssetId!) } },
          data: { voiceId: null },
        });

        const manifest = await episodesService.getManifest(episode.id);

        expect(manifest.agents.find((a) => a.id === debaterId)?.voiceId).toBeNull();
        expect(manifest.agents.find((a) => a.id === otherId)?.voiceId).not.toBeNull();
      });

      // Spec 004, pregunta B: un regenerate-audio posterior a un cambio de voz
      // deja al agente con voces mixtas; el manifest informa la de su primer
      // segmento en el orden del timeline.
      it("un agente con voces mixtas informa la de su primer segmento", async () => {
        const { episode } = await readyForRender();
        const segments = await segmentsWithAgent(episode.debateId);
        const agentId = segments[0].agentId;
        const originalVoice = segments[0].audioAsset!.voiceId;
        const laterIndex = segments.findIndex((s, i) => i > 0 && s.agentId === agentId);
        expect(laterIndex).toBeGreaterThan(0);

        await prisma.agentVoice.update({
          where: { agentId_language_provider: { agentId, language: "EN", provider: "LOCAL" } },
          data: { voiceId: "test-en-voz-nueva" },
        });
        const regenerated = await actions.regenerateAudio(episode.id, { sequenceIndex: laterIndex + 1 });
        expect(regenerated.voiceId).toBe("test-en-voz-nueva");

        const manifest = await episodesService.getManifest(episode.id);

        expect(manifest.agents.find((a) => a.id === agentId)?.voiceId).toBe(originalVoice);
      });
    });

    // AC 4.15 y 4.28: sin voz en la fase de audio -> VOICE_NOT_CONFIGURED
    // (nunca PROVIDER_QUOTA_EXCEEDED ni otra voz), validado para todos los
    // agentes pendientes antes de sintetizar nada (review de 13.6, I2);
    // resume sin cargarla -> FAILED; con la voz cargada, resume retoma solo lo
    // pendiente.
    describe("fase de audio sin voz (AC 4.15, 4.28)", () => {
      let warnSpy: jest.SpyInstance;

      beforeEach(() => {
        // handlePipelineError deja en el log qué agentes no tienen voz.
        warnSpy = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      });

      afterEach(() => {
        warnSpy.mockRestore();
      });

      function voiceWarnings(): string[] {
        return warnSpy.mock.calls.map((call) => String(call[0])).filter((msg) => msg.includes("VOICE_NOT_CONFIGURED"));
      }

      // Episodio PT en PENDING_REVIEW con 4 segmentos alternados. Devuelve a
      // los debatientes en el orden de sus segmentos (`first` dice el
      // segmento 1): el orden de turnos lo sortea resolveTurnOrder, así que
      // no se puede tomar el de EpisodeParticipant.
      async function ptEpisodeInReview() {
        const created = await episodeReadyForAudio("PT");
        const segments = await segmentsWithAgent(created.episode.debateId);
        const first = segments[0].agent;
        const second = segments.find((s) => s.agentId !== first.id)!.agent;
        return { ...created, first, second };
      }

      // Solo `first` tiene voz PT. Con la síntesis segmento a segmento de
      // antes, el segmento 1 salía y el pipeline frenaba recién en el 2: por
      // eso "no se sintetizó nada" no pasa en vacío.
      async function haltedForSecondVoice() {
        const created = await ptEpisodeInReview();
        await loadTestVoices("PT", [created.first.role!]);
        await awaitAudioPipeline(() => actions.approve(created.episode.id));
        return created;
      }

      it("frena en REQUIRES_HUMAN_REVIEW con VOICE_NOT_CONFIGURED antes de sintetizar ningún segmento, aunque el primero tenga voz", async () => {
        const { episode, first, second } = await haltedForSecondVoice();

        expect((await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } })).status).toBe("REQUIRES_HUMAN_REVIEW");
        const checkpoints = await lastCheckpoints(episode.id);
        expect(checkpoints).toHaveLength(1);
        expect(checkpoints[0]).toMatchObject({ reason: "VOICE_NOT_CONFIGURED", fromState: "GENERATING_AUDIO" });

        expect(audioProviderMock.synthesize).not.toHaveBeenCalled();
        const segments = await segmentsWithAgent(episode.debateId);
        expect(segments).toHaveLength(4);
        expect(segments.every((s) => s.audioAssetId === null)).toBe(true);
        expect((await prisma.episodeUsage.findUniqueOrThrow({ where: { episodeId: episode.id } })).ttsRequests).toBe(0);

        const [warning] = voiceWarnings();
        expect(warning).toContain("idioma PT");
        expect(warning).toContain(`(${second.role})`);
        expect(warning).not.toContain(`(${first.role})`);
      });

      // Review de 13.6, I2: con dos agentes sin voz, un solo freno que nombra
      // a los dos; cargadas las dos, un solo resume alcanza.
      it("con los dos debatientes sin voz, un solo checkpoint nombra a ambos y, cargadas las dos voces, resume completa", async () => {
        const { episode, first, second } = await ptEpisodeInReview();

        await awaitAudioPipeline(() => actions.approve(episode.id));

        expect(await lastCheckpoints(episode.id)).toHaveLength(1);
        expect(audioProviderMock.synthesize).not.toHaveBeenCalled();
        const warnings = voiceWarnings();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`(${first.role})`);
        expect(warnings[0]).toContain(`(${second.role})`);

        await loadTestVoices("PT", [first.role!, second.role!]);
        await awaitAudioPipeline(() => actions.resume(episode.id, {}));

        expect((await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } })).status).toBe("READY_FOR_RENDER");
        expect(await lastCheckpoints(episode.id)).toHaveLength(1);
        expect(audioProviderMock.synthesize).toHaveBeenCalledTimes(4);
        for (const s of await segmentsWithAgent(episode.debateId)) {
          expect(s.audioAsset?.voiceId).toBe(testVoiceId("PT", s.agent.role!));
        }
      });

      it("resume con body no vacío tira ZodError (400) sin reanudar", async () => {
        const { episode } = await haltedForSecondVoice();

        await expect(actions.resume(episode.id, { maxLlmCalls: 50 })).rejects.toThrow(ZodError);

        expect((await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } })).status).toBe("REQUIRES_HUMAN_REVIEW");
      });

      it("resume sin haber cargado la voz vuelve a frenar con el mismo motivo y el episodio pasa a FAILED (AC 4.28)", async () => {
        const { episode } = await haltedForSecondVoice();

        await awaitAudioPipeline(() => actions.resume(episode.id, {}));

        expect((await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } })).status).toBe("FAILED");
        const checkpoints = await lastCheckpoints(episode.id);
        expect(checkpoints.map((c) => c.reason)).toEqual(["VOICE_NOT_CONFIGURED", "VOICE_NOT_CONFIGURED"]);
        expect(audioProviderMock.synthesize).not.toHaveBeenCalled();
      });

      // Caso real de "voz borrada después de crear el episodio" (spec 004,
      // edge cases) con audio a medias: el proceso se cae después de
      // sintetizar 2 de los 4 segmentos (quedan en GENERATING_AUDIO, como una
      // caída real), alguien borra la voz de un agente con segmentos
      // pendientes y EpisodeRecoveryService retoma con runAudioPipeline.
      it("con la voz cargada, resume con body vacío sintetiza solo los segmentos pendientes y no vuelve a sintetizar los ya hechos", async () => {
        const { episode, first, second } = await ptEpisodeInReview();
        await loadTestVoices("PT", [first.role!, second.role!]);
        audioProviderMock.synthesize
          .mockResolvedValueOnce({ audioBuffer: Buffer.from("a"), durationMs: 1000, mimeType: "audio/wav", subtitles: [] })
          .mockResolvedValueOnce({ audioBuffer: Buffer.from("b"), durationMs: 1000, mimeType: "audio/wav", subtitles: [] })
          .mockRejectedValueOnce(new Error("el proceso se cayó a mitad del audio"));
        // El corte simulado cae como error no clasificado (queda en el log).
        const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        await awaitAudioPipeline(() => actions.approve(episode.id));
        errorSpy.mockRestore();
        expect((await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } })).status).toBe("GENERATING_AUDIO");

        const before = await segmentsWithAgent(episode.debateId);
        const alreadySynthesized = new Map(before.filter((s) => s.audioAssetId).map((s) => [s.id, s.audioAssetId]));
        const pending = before.filter((s) => !s.audioAssetId);
        expect(alreadySynthesized.size).toBe(2);
        expect(pending).toHaveLength(2);

        // Se borra la voz del agente del primer segmento pendiente y se
        // retoma como lo haría EpisodeRecoveryService en el próximo boot.
        await prisma.agentVoice.delete({
          where: { agentId_language_provider: { agentId: pending[0].agentId, language: "PT", provider: "LOCAL" } },
        });
        audioProviderMock.synthesize.mockClear();
        await orchestrator.runAudioPipeline(episode.id);

        expect((await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } })).status).toBe("REQUIRES_HUMAN_REVIEW");
        expect((await lastCheckpoints(episode.id)).map((c) => c.reason)).toEqual(["VOICE_NOT_CONFIGURED"]);
        expect(audioProviderMock.synthesize).not.toHaveBeenCalled();

        await loadTestVoices("PT", [pending[0].agent.role!]);
        await awaitAudioPipeline(() => actions.resume(episode.id, {}));

        expect((await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } })).status).toBe("READY_FOR_RENDER");
        expect(audioProviderMock.synthesize).toHaveBeenCalledTimes(pending.length);
        expect(audioProviderMock.synthesize.mock.calls.map((call) => call[0])).toEqual(pending.map((s) => s.content));
        const after = await segmentsWithAgent(episode.debateId);
        for (const s of after) {
          expect(s.audioAsset?.voiceId).toBe(testVoiceId("PT", s.agent.role!));
          if (alreadySynthesized.has(s.id)) expect(s.audioAssetId).toBe(alreadySynthesized.get(s.id));
        }
      });
    });

    // Spec 004, paso 5c (AC 4.10-4.13): el idioma se relee de
    // Episode.language en cada reentrada (EpisodeContextService para los
    // agentes, el orquestador para research y fact-check, TtsService para las
    // voces), así que sobrevive a cualquier corte. Agentes, fact-check y
    // research están mockeados en el borde: se verifica qué idioma reciben
    // (el prompt de cada idioma lo cubren sus specs unitarios).
    describe("idioma en los cortes del pipeline (AC 4.10-4.13)", () => {
      type RecordedContext = { topic: string; language: DebateLanguage };

      // Contextos que recibieron los debatientes (argue/respond/amend), solo
      // los de este episodio (el título del tópico es único por test).
      function agentContexts(topicTitle: string): RecordedContext[] {
        return agentsMock.createDebateAgent.mock.results
          .flatMap((result) => {
            const stub = result.value as ReturnType<typeof fakeArgentAgent>;
            return [...stub.argue.mock.calls, ...stub.respond.mock.calls, ...stub.amend.mock.calls].map(
              (call) => call[0] as RecordedContext
            );
          })
          .filter((context) => context.topic === topicTitle);
      }

      function judgeContexts(topicTitle: string): RecordedContext[] {
        return agentsMock.judge.mock.calls.map((call) => call[0] as RecordedContext).filter((context) => context.topic === topicTitle);
      }

      // Idioma que recibió cada llamada a FactCheckService (último parámetro).
      function factCheckLanguages(): string[] {
        return [
          ...factCheckMock.extractClaims.mock.calls.map((call) => call[3] as string),
          ...factCheckMock.check.mock.calls.map((call) => call[3] as string),
          ...factCheckMock.editorialReview.mock.calls.map((call) => call[4] as string),
        ];
      }

      function expectAllIn(values: Array<RecordedContext | string>, language: DebateLanguage) {
        expect(values.length).toBeGreaterThan(0);
        for (const value of values) expect(typeof value === "string" ? value : value.language).toBe(language);
      }

      async function awaitPipeline(trigger: () => Promise<unknown>): Promise<void> {
        const spy = jest.spyOn(orchestrator, "runPipeline");
        try {
          await trigger();
          await spy.mock.results[spy.mock.results.length - 1].value;
        } finally {
          spy.mockRestore();
        }
      }

      async function status(episodeId: string) {
        return (await prisma.episode.findUniqueOrThrow({ where: { id: episodeId } })).status;
      }

      // Recovery solo sobre este episodio: otros tests pueden dejar episodios
      // en fases activas, y sus pipelines mezclarían llamadas en los mocks.
      async function recoverOnly(episodeId: string): Promise<void> {
        const runPipeline = orchestrator.runPipeline.bind(orchestrator);
        const runAudioPipeline = orchestrator.runAudioPipeline.bind(orchestrator);
        const pipelineSpy = jest
          .spyOn(orchestrator, "runPipeline")
          .mockImplementation((id, opts) => (id === episodeId ? runPipeline(id, opts) : Promise.resolve()));
        const audioSpy = jest
          .spyOn(orchestrator, "runAudioPipeline")
          .mockImplementation((id) => (id === episodeId ? runAudioPipeline(id) : Promise.resolve()));
        try {
          await recovery.onApplicationBootstrap();
          const runs = [
            ...pipelineSpy.mock.calls.map((call, i) => ({ id: call[0], done: pipelineSpy.mock.results[i].value as Promise<void> })),
            ...audioSpy.mock.calls.map((call, i) => ({ id: call[0], done: audioSpy.mock.results[i].value as Promise<void> })),
          ].filter((run) => run.id === episodeId);
          expect(runs).toHaveLength(1);
          await runs[0].done;
        } finally {
          pipelineSpy.mockRestore();
          audioSpy.mockRestore();
        }
      }

      // Un error no clasificado deja el episodio en su fase activa, igual que
      // una caída real del proceso (handlePipelineError, último caso).
      function crash(): Error {
        return new Error("caída simulada del proceso");
      }

      let errorSpy: jest.SpyInstance;
      beforeEach(() => {
        errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
      });
      afterEach(() => {
        errorSpy.mockRestore();
      });

      describe("AC 4.10: episodio EN reanudado con resume", () => {
        it("desde DEBATING: los argumentos que faltan, su fact-check y el veredicto salen en EN", async () => {
          const { topic, episode } = await createTestEpisode(prisma, { language: "EN", rebuttalRounds: 1 });
          researchMock.research.mockImplementation((topicId: string) => persistFakeResearch(prisma, topicId));
          factCheckMock.extractClaims.mockRejectedValueOnce(new DailyQuotaExceededError("GOOGLE", 500));

          await orchestrator.runPipeline(episode.id);
          expect(await status(episode.id)).toBe("REQUIRES_HUMAN_REVIEW");
          expect((await lastCheckpoints(episode.id))[0]).toMatchObject({ reason: "PROVIDER_QUOTA_EXCEEDED", fromState: "DEBATING" });

          agentsMock.createDebateAgent.mockClear();
          agentsMock.judge.mockClear();
          factCheckMock.extractClaims.mockClear();
          factCheckMock.check.mockClear();
          factCheckMock.editorialReview.mockClear();
          await awaitPipeline(() => actions.resume(episode.id, {}));

          expect(await status(episode.id)).toBe("PENDING_REVIEW");
          expectAllIn(agentContexts(topic.title), "EN");
          expectAllIn(factCheckLanguages(), "EN");
          expectAllIn(judgeContexts(topic.title), "EN");
        });

        it("desde JUDGING: el veredicto sale en EN", async () => {
          const { topic, episode } = await createTestEpisode(prisma, { language: "EN" });
          researchMock.research.mockImplementation((topicId: string) => persistFakeResearch(prisma, topicId));
          agentsMock.judge.mockRejectedValueOnce(new DailyQuotaExceededError("GOOGLE", 500));

          await orchestrator.runPipeline(episode.id);
          expect((await lastCheckpoints(episode.id))[0]).toMatchObject({ reason: "PROVIDER_QUOTA_EXCEEDED", fromState: "JUDGING" });

          agentsMock.judge.mockClear();
          await awaitPipeline(() => actions.resume(episode.id, {}));

          expect(await status(episode.id)).toBe("PENDING_REVIEW");
          const judged = judgeContexts(topic.title);
          expect(judged).toHaveLength(1);
          expectAllIn(judged, "EN");
        });

        it("desde GENERATING_AUDIO: los segmentos pendientes se sintetizan con las voces EN", async () => {
          await loadTestVoices("EN");
          const { episode } = await episodeReadyForAudio("EN");
          audioProviderMock.synthesize.mockRejectedValueOnce(new TtsProviderUnavailableError("LOCAL"));

          await awaitAudioPipeline(() => actions.approve(episode.id));
          expect((await lastCheckpoints(episode.id))[0]).toMatchObject({
            reason: "PROVIDER_QUOTA_EXCEEDED",
            fromState: "GENERATING_AUDIO",
          });

          audioProviderMock.synthesize.mockClear();
          await awaitAudioPipeline(() => actions.resume(episode.id, {}));

          expect(await status(episode.id)).toBe("READY_FOR_RENDER");
          const segments = await segmentsWithAgent(episode.debateId);
          expect(audioProviderMock.synthesize).toHaveBeenCalledTimes(segments.length);
          for (const s of segments) {
            expect(audioProviderMock.synthesize).toHaveBeenCalledWith(s.content, testVoiceId("EN", s.agent.role!));
            expect(s.audioAsset?.voiceId).toBe(testVoiceId("EN", s.agent.role!));
          }
        });
      });

      describe("AC 4.11: episodio PT retomado por EpisodeRecoveryService", () => {
        it("en DEBATING: los argumentos, su fact-check y el veredicto salen en PT", async () => {
          const { topic, episode } = await createTestEpisode(prisma, { language: "PT", rebuttalRounds: 1 });
          researchMock.research.mockImplementation((topicId: string) => persistFakeResearch(prisma, topicId));
          factCheckMock.extractClaims.mockRejectedValueOnce(crash());
          await orchestrator.runPipeline(episode.id);
          expect(await status(episode.id)).toBe("DEBATING");

          agentsMock.createDebateAgent.mockClear();
          agentsMock.judge.mockClear();
          factCheckMock.extractClaims.mockClear();
          factCheckMock.check.mockClear();
          factCheckMock.editorialReview.mockClear();
          await recoverOnly(episode.id);

          expect(await status(episode.id)).toBe("PENDING_REVIEW");
          expectAllIn(agentContexts(topic.title), "PT");
          expectAllIn(factCheckLanguages(), "PT");
          expectAllIn(judgeContexts(topic.title), "PT");
        });

        it("en JUDGING: el veredicto sale en PT", async () => {
          const { topic, episode } = await createTestEpisode(prisma, { language: "PT" });
          researchMock.research.mockImplementation((topicId: string) => persistFakeResearch(prisma, topicId));
          agentsMock.judge.mockRejectedValueOnce(crash());
          await orchestrator.runPipeline(episode.id);
          expect(await status(episode.id)).toBe("JUDGING");

          agentsMock.judge.mockClear();
          await recoverOnly(episode.id);

          expect(await status(episode.id)).toBe("PENDING_REVIEW");
          const judged = judgeContexts(topic.title);
          expect(judged).toHaveLength(1);
          expectAllIn(judged, "PT");
        });

        it("en GENERATING_AUDIO: los segmentos pendientes se sintetizan con las voces PT", async () => {
          await loadTestVoices("PT");
          const { episode } = await episodeReadyForAudio("PT");
          audioProviderMock.synthesize.mockRejectedValueOnce(crash());
          await awaitAudioPipeline(() => actions.approve(episode.id));
          expect(await status(episode.id)).toBe("GENERATING_AUDIO");

          audioProviderMock.synthesize.mockClear();
          await recoverOnly(episode.id);

          expect(await status(episode.id)).toBe("READY_FOR_RENDER");
          const segments = await segmentsWithAgent(episode.debateId);
          expect(audioProviderMock.synthesize).toHaveBeenCalledTimes(segments.length);
          for (const s of segments) {
            expect(audioProviderMock.synthesize).toHaveBeenCalledWith(s.content, testVoiceId("PT", s.agent.role!));
            expect(s.audioAsset?.voiceId).toBe(testVoiceId("PT", s.agent.role!));
          }
        });
      });

      // AC 4.12 y AC 4.6 (regenerate y el judge de regenerate-verdict): las
      // dos acciones de curaduría usan el mismo EpisodeContextService que el
      // orquestador, así que reciben el idioma sin pasarlo a mano.
      it("AC 4.12: regenerate y regenerate-verdict en PENDING_REVIEW sobre un episodio EN usan el contexto compartido, en EN", async () => {
        const { topic, episode } = await createTestEpisode(prisma, { language: "EN" });
        researchMock.research.mockImplementation((topicId: string) => persistFakeResearch(prisma, topicId));
        await orchestrator.runPipeline(episode.id);
        expect(await status(episode.id)).toBe("PENDING_REVIEW");
        const [argument] = await segmentsWithAgent(episode.debateId);

        agentsMock.createDebateAgent.mockClear();
        agentsMock.judge.mockClear();
        await actions.regenerate(episode.id, { argumentId: argument.id });
        await actions.regenerateVerdict(episode.id);

        const regenerated = agentContexts(topic.title);
        expect(regenerated).toHaveLength(1);
        expectAllIn(regenerated, "EN");
        const judged = judgeContexts(topic.title);
        expect(judged).toHaveLength(1);
        expectAllIn(judged, "EN");
      });

      it("AC 4.13: resume de INSUFFICIENT_EVIDENCE en un episodio EN vuelve a extraer los hechos en EN", async () => {
        const { topic, episode } = await createTestEpisode(prisma, { language: "EN" });
        researchMock.research.mockRejectedValueOnce(new InsufficientEvidenceError(1));
        await orchestrator.runPipeline(episode.id);
        expect((await lastCheckpoints(episode.id))[0]).toMatchObject({ reason: "INSUFFICIENT_EVIDENCE" });
        expect(researchMock.research).toHaveBeenCalledWith(topic.id, "EN", undefined);

        researchMock.research.mockClear();
        researchMock.research.mockImplementation((topicId: string) => persistFakeResearch(prisma, topicId));
        const manualSources = [{ url: "https://example.com/manual-en", title: "Manual", snippet: "Manual source" }];
        await awaitPipeline(() => actions.resume(episode.id, { manualSources }));

        expect(researchMock.research).toHaveBeenCalledTimes(1);
        expect(researchMock.research).toHaveBeenCalledWith(topic.id, "EN", manualSources);
        expect(await status(episode.id)).toBe("PENDING_REVIEW");
      });
    });
  });
});
