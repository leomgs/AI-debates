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
import { EpisodeListItemSchema } from './../src/modules/episodes/dto/episode.schema';
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

    // Decisión del usuario (review F2-1): SSE explícito según el caso.
    it('episodio existente sin pipeline activo: 204, sin text/event-stream y body vacío', async () => {
      const { episode } = await seedEpisode(prisma, 'DEBATING');

      const res = await openSse(baseUrl, `/episodes/${episode.id}/events`, cookie);
      const body = await readAll(res);

      expect(res.statusCode).toBe(204);
      expect(res.headers['content-type'] ?? '').not.toMatch(/text\/event-stream/);
      expect(body).toBe('');
    });

    it('episodio inexistente: 404 NOT_FOUND con el envelope de error, sin abrir el stream', async () => {
      const res = await openSse(baseUrl, '/episodes/00000000-0000-4000-8000-000000000000/events', cookie);
      const body = await readAll(res);

      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toMatch(/application\/json/);
      expect(res.headers['content-type']).not.toMatch(/text\/event-stream/);
      expect(JSON.parse(body)).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
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

    // Decisión del usuario (review F2-1): sin línea `data:`, EventSource
    // descarta el evento. Se mira el frame crudo tal como sale por el wire.
    it('research.started y episode.pending_review salen con una línea "data: {}"', async () => {
      const { episode } = await seedEpisode(prisma, 'DEBATING');
      events.begin(episode.id);

      const res = await openSse(baseUrl, `/episodes/${episode.id}/events`, cookie);
      const bodyPromise = readAll(res);
      events.emit(episode.id, 'research.started');
      events.emit(episode.id, 'episode.pending_review');
      events.complete(episode.id);
      const body = await bodyPromise;

      expect(body).toMatch(/event: research\.started\nid: \d+\ndata: \{\}\n\n/);
      expect(body).toMatch(/event: episode\.pending_review\nid: \d+\ndata: \{\}\n\n/);
    });
  });

  describe('API-1 (parte 1): tópico, createdAt y participantes en el detalle', () => {
    it('GET /episodes/:id cumple EpisodeDetailSchema y trae los participantes, debatientes primero', async () => {
      const { topic, episode } = await seedEpisode(prisma, 'PENDING_REVIEW');
      const judge = await prisma.agent.create({ data: { name: 'Judge e2e', role: 'JUDGE', systemPrompt: '-' } });
      const analyst = await prisma.agent.create({ data: { name: 'Analyst e2e', role: 'ANALYST', systemPrompt: '-' } });
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

  describe('API-7a: publishedAt en detalle y listado', () => {
    it('es null por defecto y sale en ISO cuando la columna tiene valor', async () => {
      const { episode } = await seedEpisode(prisma, 'PENDING_REVIEW');

      const detail = await request(app.getHttpServer()).get(`/episodes/${episode.id}`).set('Cookie', cookie).expect(200);
      expect(detail.body.publishedAt).toBeNull();

      // Ninguna acción la escribe todavía (API-7); se setea directo en la base.
      const publishedAt = new Date('2026-09-25T12:00:00.000Z');
      await prisma.episode.update({ where: { id: episode.id }, data: { publishedAt } });

      const after = await request(app.getHttpServer()).get(`/episodes/${episode.id}`).set('Cookie', cookie).expect(200);
      expect(after.body.publishedAt).toBe(publishedAt.toISOString());

      const list = await request(app.getHttpServer()).get('/episodes').set('Cookie', cookie).expect(200);
      const items = z.array(EpisodeListItemSchema).parse(list.body);
      expect(items.find((e) => e.id === episode.id)?.publishedAt).toBe(publishedAt.toISOString());
      expect(items.filter((e) => e.id !== episode.id).every((e) => e.publishedAt === null)).toBe(true);
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
