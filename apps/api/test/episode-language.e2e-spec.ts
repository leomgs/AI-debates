import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { z } from 'zod';
import { RemotionManifestSchema } from '@ai-trend-debates/contracts';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';
import type { Env } from './../src/shared/config/env.schema';
import { PrismaService } from './../src/shared/prisma/prisma.service';
import { EpisodeOrchestratorService } from './../src/modules/episodes/episode-orchestrator.service';
import { EpisodeDetailSchema } from './../src/modules/episodes/episode-detail.mapper';
import { EpisodeListItemSchema, EpisodeSchema } from './../src/modules/episodes/dto/episode.schema';
import { DEBATER_PERSONAS, JUDGE } from './../src/shared/personas/agents.personas';
import { E2E_CURATOR_PASSWORD, E2E_CURATOR_USERNAME } from './e2e-auth.fixture';

// Spec 004, paso 13.7: `language` en la API. Archivo propio porque AC 4.29
// necesita una base con exactamente un agente por rol candidato y solo voces
// ES (como la deja el seed del MVP); jest-e2e.setup.ts recrea la base antes
// de cada archivo, así que los agentes sin voz que crean otros e2e no
// interfieren con la resolución por rol de createEpisode.
const CANDIDATE_ROLES = [...Object.values(DEBATER_PERSONAS).map((p) => p.id), JUDGE.id];

async function createApp(): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  configureApp(app, app.get<ConfigService<Env, true>>(ConfigService));
  await app.init();
  return app;
}

async function login(app: INestApplication<App>): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ username: E2E_CURATOR_USERNAME, password: E2E_CURATOR_PASSWORD })
    .expect(200);
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = setCookie.find((c) => c.startsWith('atd_session='));
  if (!cookie) throw new Error('La respuesta no trae la cookie atd_session');
  return cookie.split(';')[0];
}

async function countCreationRows(prisma: PrismaService) {
  const [topics, debates, episodes, usages] = await Promise.all([
    prisma.topic.count(),
    prisma.debate.count(),
    prisma.episode.count(),
    prisma.episodeUsage.count(),
  ]);
  return { topics, debates, episodes, usages };
}

describe('Idioma del episodio en la API (e2e, spec 004)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cookie: string;
  let runPipelineSpy: jest.SpyInstance;
  const agentIdsByRole = new Map<string, string>();

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    cookie = await login(app);

    // Un agente por rol candidato, cada uno con su voz ES/LOCAL de prueba
    // (id visiblemente ficticio, D14) y ninguna fila EN/PT (D20).
    for (const role of CANDIDATE_ROLES) {
      const agent = await prisma.agent.create({
        data: {
          name: `Agente ${role}`,
          role,
          systemPrompt: '-',
          voices: { create: { language: 'ES', provider: 'LOCAL', voiceId: `test-es-${role.toLowerCase()}` } },
        },
      });
      agentIdsByRole.set(role, agent.id);
    }
  });

  beforeEach(() => {
    // POST /episodes dispara el pipeline sin esperarlo: acá nunca corre (no
    // hay LLM ni búsqueda reales en los e2e).
    runPipelineSpy = jest.spyOn(app.get(EpisodeOrchestratorService), 'runPipeline').mockResolvedValue(undefined);
  });

  afterEach(() => {
    runPipelineSpy.mockRestore();
  });

  afterAll(async () => {
    await app.close();
  });

  // AC 4.1, 4.2, 4.29 y el orden de D15: 400 (Zod) -> 409 (voces) -> inserts.
  describe('POST /episodes', () => {
    it.each(['EN', 'PT'] as const)(
      'con solo voces ES, language %s → 409 VOICE_NOT_CONFIGURED con idioma, LOCAL y los 5 candidatos, sin crear filas',
      async (language) => {
        const before = await countCreationRows(prisma);

        const res = await request(app.getHttpServer())
          .post('/episodes')
          .set('Cookie', cookie)
          .send({ topic: `Trend ${language}`, language })
          .expect(409);

        expect(res.body).toEqual({ error: { code: 'VOICE_NOT_CONFIGURED', message: expect.any(String) } });
        const message: string = res.body.error.message;
        expect(message).toContain(`idioma ${language}`);
        expect(message).toContain('"LOCAL"');
        for (const role of CANDIDATE_ROLES) expect(message).toContain(`(${role})`);
        expect(await countCreationRows(prisma)).toEqual(before);
        expect(runPipelineSpy).not.toHaveBeenCalled();
      },
    );

    it.each([['FR'], ['es'], [''], [null], [3]])(
      'language inválido (%p) → 400 VALIDATION_ERROR antes del chequeo de voces, sin crear filas',
      async (language) => {
        const before = await countCreationRows(prisma);

        const res = await request(app.getHttpServer())
          .post('/episodes')
          .set('Cookie', cookie)
          .send({ topic: 'Trend inválido', language })
          .expect(400);

        // 400 y no 409: ningún idioma inválido tiene voces, así que si el
        // chequeo de voces corriera antes que Zod, la respuesta sería 409.
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(await countCreationRows(prisma)).toEqual(before);
        expect(runPipelineSpy).not.toHaveBeenCalled();
      },
    );

    it('un campo de más en el body → 400 VALIDATION_ERROR (.strict())', async () => {
      const res = await request(app.getHttpServer())
        .post('/episodes')
        .set('Cookie', cookie)
        .send({ topic: 'Trend', language: 'ES', extra: true })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it.each([
      ['explícito', { language: 'ES' }],
      ['omitido', {}],
    ])('language ES %s → 201, crea las 4 filas y el episodio queda en ES', async (_label, extra) => {
      const before = await countCreationRows(prisma);

      const res = await request(app.getHttpServer())
        .post('/episodes')
        .set('Cookie', cookie)
        .send({ topic: `Trend ES ${randomUUID()}`, ...extra })
        .expect(201);

      const episode = EpisodeSchema.parse(res.body);
      expect(episode.language).toBe('ES');
      expect((await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } })).language).toBe('ES');
      expect(await countCreationRows(prisma)).toEqual({
        topics: before.topics + 1,
        debates: before.debates + 1,
        episodes: before.episodes + 1,
        usages: before.usages + 1,
      });
      expect(runPipelineSpy).toHaveBeenCalledWith(episode.id);
    });
  });

  // AC 4.18: language en el listado y en el detalle.
  it('GET /episodes y GET /episodes/:id exponen el language del episodio', async () => {
    const topic = await prisma.topic.create({ data: { title: 'Trend PT', context: 'Trend PT' } });
    const debate = await prisma.debate.create({ data: { topicId: topic.id } });
    const episode = await prisma.episode.create({
      data: { debateId: debate.id, title: 'Trend PT', status: 'PENDING_REVIEW', language: 'PT' },
    });

    const list = await request(app.getHttpServer()).get('/episodes').set('Cookie', cookie).expect(200);
    const items = z.array(EpisodeListItemSchema).parse(list.body);
    expect(items.find((e) => e.id === episode.id)?.language).toBe('PT');
    expect(items.filter((e) => e.id !== episode.id).every((e) => e.language === 'ES')).toBe(true);

    const detail = await request(app.getHttpServer()).get(`/episodes/${episode.id}`).set('Cookie', cookie).expect(200);
    expect(EpisodeDetailSchema.parse(detail.body).language).toBe('PT');
  });

  // AC 4.3: ninguna acción acepta language. Los schemas de resume son
  // .strict(): un body con language no matchea ninguna rama de la unión.
  it('resume con language en el body → 400 VALIDATION_ERROR, sin reanudar ni cambiar el idioma', async () => {
    const topic = await prisma.topic.create({ data: { title: 'Trend', context: 'Trend' } });
    const debate = await prisma.debate.create({ data: { topicId: topic.id } });
    const episode = await prisma.episode.create({
      data: { debateId: debate.id, title: 'Trend', status: 'REQUIRES_HUMAN_REVIEW', language: 'ES' },
    });
    await prisma.episodeCheckpoint.create({
      data: { episodeId: episode.id, fromState: 'GENERATING_AUDIO', reason: 'VOICE_NOT_CONFIGURED', snapshot: '{}' },
    });

    const res = await request(app.getHttpServer())
      .post(`/episodes/${episode.id}/actions/resume`)
      .set('Cookie', cookie)
      .send({ language: 'EN' })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const after = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
    expect(after.status).toBe('REQUIRES_HUMAN_REVIEW');
    expect(after.language).toBe('ES');
  });

  // AC 4.16 y 4.18 por HTTP: @ZodResponse valida la respuesta contra
  // RemotionManifestSchema, así que un voiceId null solo sale en 200 si el
  // contrato lo acepta. Borrar la voz del juez no cambia nada (D17 revisado).
  it('GET /episodes/:id/manifest → 200 con meta.language del episodio y el juez con voiceId null, aunque se borre su voz', async () => {
    const analystId = agentIdsByRole.get('ANALYST')!;
    const judgeId = agentIdsByRole.get(JUDGE.id)!;
    const topic = await prisma.topic.create({ data: { title: 'Trend manifest', context: 'Trend manifest' } });
    const debate = await prisma.debate.create({ data: { topicId: topic.id } });
    const episode = await prisma.episode.create({
      data: { debateId: debate.id, title: 'Trend manifest', status: 'READY_FOR_RENDER', language: 'ES' },
    });
    await prisma.episodeParticipant.create({ data: { episodeId: episode.id, agentId: analystId, modelProvider: 'GOOGLE' } });
    await prisma.episodeParticipant.create({
      data: { episodeId: episode.id, agentId: judgeId, modelProvider: 'GOOGLE', isJudge: true },
    });
    const round = await prisma.debateRound.create({ data: { debateId: debate.id, round: 1, type: 'OPENING' } });
    const audio = await prisma.audioAsset.create({
      data: {
        storageKey: `${episode.id}/segmento.wav`,
        provider: 'LOCAL',
        durationMs: 1500,
        mimeType: 'audio/wav',
        voiceId: 'test-es-analyst-guardada',
      },
    });
    await prisma.argument.create({
      data: { debateRoundId: round.id, agentId: analystId, content: 'Argumento.', status: 'OFFICIAL', audioAssetId: audio.id },
    });
    await prisma.verdict.create({ data: { debateId: debate.id, judgeId, content: 'Veredicto.', winnerId: analystId } });

    const res = await request(app.getHttpServer()).get(`/episodes/${episode.id}/manifest`).set('Cookie', cookie).expect(200);

    const manifest = RemotionManifestSchema.parse(res.body);
    expect(manifest.meta.language).toBe('ES');
    expect(manifest.agents.find((a) => a.id === judgeId)?.voiceId).toBeNull();
    expect(manifest.agents.find((a) => a.id === analystId)?.voiceId).toBe('test-es-analyst-guardada');

    const judgeVoices = await prisma.agentVoice.findMany({ where: { agentId: judgeId } });
    await prisma.agentVoice.deleteMany({ where: { agentId: judgeId } });
    try {
      const after = await request(app.getHttpServer()).get(`/episodes/${episode.id}/manifest`).set('Cookie', cookie).expect(200);
      expect(after.body.agents).toEqual(res.body.agents);
      expect(after.body.meta).toEqual(res.body.meta);
    } finally {
      await prisma.agentVoice.createMany({ data: judgeVoices });
    }
  });
});
