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
});
