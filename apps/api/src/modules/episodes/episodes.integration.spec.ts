import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
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

async function seedAgents(prisma: PrismaService): Promise<void> {
  for (const persona of Object.values(DEBATER_PERSONAS)) {
    await prisma.agent.create({
      data: { name: persona.displayName, role: persona.id, systemPrompt: "prompt de prueba", voiceId: "voice-test" },
    });
  }
  await prisma.agent.create({
    data: { name: JUDGE.displayName, role: JUDGE.id, systemPrompt: "prompt de prueba", voiceId: "voice-test" },
  });
}

async function createTestEpisode(prisma: PrismaService, overrides: Partial<{ maxRevisionAttempts: number }> = {}) {
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

    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule, EpisodesModule],
    })
      .overrideProvider(ResearchService)
      .useValue(researchMock)
      .overrideProvider(AgentsService)
      .useValue(agentsMock)
      .overrideProvider(FactCheckService)
      .useValue(factCheckMock)
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
    // su foto ENTRE las dos escrituras del edit. Se la fuerza sin sleeps:
    // la transacción de editByHuman se frena antes de su segunda escritura
    // hasta que el juez ya leyó el contexto, y el juez no contesta hasta que
    // el edit terminó. Con update → historial, esa foto ya ve el texto nuevo
    // y el historial es posterior a judgedFrom, así que sale stale: true
    // (el lado seguro). Con el orden inverso, el juez leería el texto viejo
    // y el veredicto saldría stale: false.
    it("un juez que toma su foto entre las dos escrituras del edit nunca lee el texto viejo sin quedar desactualizado", async () => {
      const { episode } = await episodeInPendingReview();
      const detail = await episodesService.getEpisodeDetail(episode.id);
      const argumentId = detail.debate.rounds[0].arguments[0].id;
      const newText = "Editado justo mientras el juez tomaba su foto.";

      let judgeSawContext!: (context: { officialArguments: Array<{ content: string }> }) => void;
      const judgeContext = new Promise<{ officialArguments: Array<{ content: string }> }>((resolve) => (judgeSawContext = resolve));
      let finishEdit!: () => void;
      const editFinished = new Promise<void>((resolve) => (finishEdit = resolve));
      agentsMock.judge.mockImplementationOnce(async (context: { officialArguments: Array<{ content: string }> }) => {
        judgeSawContext(context);
        await editFinished;
        return { content: "Veredicto con foto en el medio del edit.", winnerAgentId: null };
      });

      let regenerating: Promise<Awaited<ReturnType<EpisodeActionsService["regenerateVerdict"]>>> | undefined;
      const realTransaction = prisma.$transaction.bind(prisma) as (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>;
      const spy = jest.spyOn(prisma, "$transaction").mockImplementationOnce(((fn: (tx: unknown) => Promise<unknown>) =>
        realTransaction((tx) => {
          // Cuenta las escrituras de Argument/ArgumentHistory del edit y,
          // antes de la segunda, arranca regenerate-verdict y espera a que
          // el juez tenga su contexto.
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
                    regenerating = actions.regenerateVerdict(episode.id);
                    await judgeContext;
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
        await actions.edit(episode.id, { argumentId, content: newText });
      } finally {
        spy.mockRestore();
      }
      finishEdit();
      expect(regenerating).toBeDefined();
      const replaced = await regenerating!;

      const seen = (await judgeContext).officialArguments.map((a) => a.content);
      expect(seen).toContain(newText);
      expect(replaced.stale).toBe(true);
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
});
