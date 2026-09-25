import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { get as httpGet, type IncomingMessage } from 'node:http';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';
import type { Env } from './../src/shared/config/env.schema';
import { PrismaService } from './../src/shared/prisma/prisma.service';
import { EpisodeEventsService } from './../src/modules/episodes/episode-events.service';
import { NotificationSchema } from './../src/modules/notifications/dto/notification.schema';
import { EpisodeDetailSchema } from './../src/modules/episodes/episode-detail.mapper';
import { z } from 'zod';
import { E2E_CURATOR_PASSWORD, E2E_CURATOR_USERNAME } from './e2e-auth.fixture';

// Spec 003, dependencias de backend de la F2 (API-12 y siguientes) contra
// AppModule completo, con sesión real. Los episodios se insertan directo en
// la base (sin POST /episodes) para no disparar el pipeline: así se controla
// a mano si hay una corrida activa, vía EpisodeEventsService.
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

async function seedEpisode(prisma: PrismaService, status: 'DEBATING' | 'PENDING_REVIEW') {
  const topic = await prisma.topic.create({ data: { title: 'Un trend', context: 'Un trend' } });
  const debate = await prisma.debate.create({ data: { topicId: topic.id } });
  const episode = await prisma.episode.create({ data: { debateId: debate.id, title: 'Un trend', status } });
  return { topic, debate, episode };
}

// Abre el SSE con un GET crudo (no supertest, que espera a que termine el
// body) y resuelve con la respuesta apenas llegan los headers.
function openSse(baseUrl: string, path: string, cookie: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    httpGet(`${baseUrl}${path}`, { headers: { Cookie: cookie, Accept: 'text/event-stream' } }, resolve).on('error', reject);
  });
}

function readAll(res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk: string) => (body += chunk));
    res.on('end', () => resolve(body));
    res.on('error', reject);
  });
}

describe('Episodes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let events: EpisodeEventsService;
  let cookie: string;
  let baseUrl: string;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    events = app.get(EpisodeEventsService);
    cookie = await login(app);
    const server = app.getHttpServer() as unknown as Server;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('API-12: pipelineActive y SSE', () => {
    it('GET /episodes/:id expone pipelineActive según haya una corrida en curso', async () => {
      const { episode } = await seedEpisode(prisma, 'DEBATING');

      const stuck = await request(app.getHttpServer()).get(`/episodes/${episode.id}`).set('Cookie', cookie).expect(200);
      expect(stuck.body).toMatchObject({ id: episode.id, status: 'DEBATING', pipelineActive: false });

      events.begin(episode.id);
      try {
        const active = await request(app.getHttpServer()).get(`/episodes/${episode.id}`).set('Cookie', cookie).expect(200);
        expect(active.body.pipelineActive).toBe(true);
      } finally {
        events.complete(episode.id);
      }
    });

    it('sin pipeline activo, el SSE responde y cierra enseguida sin eventos', async () => {
      const { episode } = await seedEpisode(prisma, 'DEBATING');

      const res = await openSse(baseUrl, `/episodes/${episode.id}/events`, cookie);
      const body = await readAll(res);

      expect(res.statusCode).toBe(200);
      expect(body).not.toMatch(/event:/);
    });

    it('con pipeline activo, el SSE entrega los eventos y cierra cuando la corrida termina', async () => {
      const { episode } = await seedEpisode(prisma, 'DEBATING');
      events.begin(episode.id);

      const res = await openSse(baseUrl, `/episodes/${episode.id}/events`, cookie);
      const bodyPromise = readAll(res);
      events.emit(episode.id, 'research.started');
      events.complete(episode.id);
      const body = await bodyPromise;

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/event-stream/);
      // API-13: que ningún proxy (ni la compresión del rewrite de Next)
      // transforme o bufferee el stream. Lo pone Nest, no este proyecto.
      expect(res.headers['cache-control']).toMatch(/\bno-transform\b/);
      expect(body).toMatch(/event: research\.started/);
    });
  });

  describe('API-1 (parte 1): tópico, createdAt y participantes en el detalle', () => {
    it('GET /episodes/:id cumple EpisodeDetailSchema y trae los participantes, debatientes primero', async () => {
      const { topic, episode } = await seedEpisode(prisma, 'PENDING_REVIEW');
      const voiceId = { LOCAL: 'x', GOOGLE_TTS: 'es', OPENROUTER: 'TBD' };
      const judge = await prisma.agent.create({ data: { name: 'Judge e2e', role: 'JUDGE', systemPrompt: '-', voiceId } });
      const analyst = await prisma.agent.create({ data: { name: 'Analyst e2e', role: 'ANALYST', systemPrompt: '-', voiceId } });
      await prisma.episodeParticipant.create({ data: { episodeId: episode.id, agentId: judge.id, modelProvider: 'GOOGLE', isJudge: true } });
      await prisma.episodeParticipant.create({ data: { episodeId: episode.id, agentId: analyst.id, modelProvider: 'GOOGLE' } });

      const res = await request(app.getHttpServer()).get(`/episodes/${episode.id}`).set('Cookie', cookie).expect(200);

      const detail = EpisodeDetailSchema.parse(res.body);
      expect(detail.topic).toEqual({ id: topic.id, title: 'Un trend' });
      expect(detail.createdAt).toBe(episode.createdAt.toISOString());
      expect(detail.participants).toEqual([
        { agentId: analyst.id, name: 'Analyst e2e', role: 'ANALYST', isJudge: false },
        { agentId: judge.id, name: 'Judge e2e', role: 'JUDGE', isJudge: true },
      ]);
    });
  });

  describe('API-5: respuestas de /notifications', () => {
    it('listar, marcar una y marcar todas responden con el shape documentado', async () => {
      const { episode } = await seedEpisode(prisma, 'PENDING_REVIEW');
      const first = await prisma.notification.create({
        data: { episodeId: episode.id, type: 'EPISODE_PENDING_REVIEW', message: 'El episodio está listo para revisión.' },
      });
      await prisma.notification.create({
        data: { episodeId: episode.id, type: 'EPISODE_REQUIRES_REVIEW', message: 'El episodio requiere revisión: X.' },
      });

      const list = await request(app.getHttpServer()).get('/notifications').set('Cookie', cookie).expect(200);
      expect(z.array(NotificationSchema).parse(list.body)).toHaveLength(2);
      expect(list.body[0]).toEqual({
        id: expect.any(String),
        episodeId: episode.id,
        type: expect.any(String),
        message: expect.any(String),
        readAt: null,
        createdAt: expect.any(String),
      });

      const read = await request(app.getHttpServer())
        .post(`/notifications/${first.id}/read`)
        .set('Cookie', cookie)
        .expect(201);
      expect(NotificationSchema.parse(read.body)).toMatchObject({ id: first.id, readAt: expect.any(String) });

      const readAll = await request(app.getHttpServer()).post('/notifications/read-all').set('Cookie', cookie).expect(201);
      expect(readAll.body).toEqual({ count: 1 });

      const unread = await request(app.getHttpServer()).get('/notifications').set('Cookie', cookie).expect(200);
      expect(unread.body).toEqual([]);
    });
  });
});
