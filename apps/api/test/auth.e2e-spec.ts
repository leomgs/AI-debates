import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';
import type { Env } from './../src/shared/config/env.schema';
import { LOGIN_RATE_LIMIT } from './../src/modules/auth/login-rate-limiter.service';
import { E2E_CURATOR_PASSWORD, E2E_CURATOR_USERNAME } from './e2e-auth.fixture';

// API-8 (ADR 0001, spec 003 AC 3.2-3.5 y 3.8) — AppModule completo, con el
// SessionGuard global real y el mismo configureApp() que main.ts (filter,
// trust proxy, estáticos, Swagger), para verificar el envelope
// { error: { code, message } } y el resto del wiring de punta a punta.
async function createApp(): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  configureApp(app, app.get<ConfigService<Env, true>>(ConfigService));
  await app.init();
  return app;
}

function sessionCookieFrom(res: request.Response): string {
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = setCookie.find((c) => c.startsWith('atd_session='));
  if (!cookie) throw new Error('La respuesta no trae la cookie atd_session');
  return cookie;
}

async function login(app: INestApplication<App>): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ username: E2E_CURATOR_USERNAME, password: E2E_CURATOR_PASSWORD })
    .expect(200);
  // Solo "nombre=valor", como lo reenvía el navegador en el header Cookie.
  return sessionCookieFrom(res).split(';')[0];
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['GET', '/episodes'],
    ['GET', '/episodes/00000000-0000-0000-0000-000000000000'],
    ['GET', '/episodes/00000000-0000-0000-0000-000000000000/events'],
    ['POST', '/episodes/00000000-0000-0000-0000-000000000000/actions/approve'],
    ['POST', '/episodes'],
    ['GET', '/notifications'],
    ['POST', '/notifications/read-all'],
    ['GET', '/auth/session'],
  ])('sin cookie, %s %s responde 401 UNAUTHORIZED', async (method, path) => {
    const res = await request(app.getHttpServer())[method === 'GET' ? 'get' : 'post'](path).expect(401);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
  });

  it('una cookie alterada también es 401', async () => {
    const cookie = await login(app);
    const tampered = cookie.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    await request(app.getHttpServer()).get('/episodes').set('Cookie', tampered).expect(401);
  });

  it('fuera de producción, /docs (Swagger) está montado y es público', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200);
  });

  it('GET / sigue siendo público', () => {
    return request(app.getHttpServer()).get('/').expect(200).expect('Hello World!');
  });

  it('login con credencial incorrecta: 401 INVALID_CREDENTIALS, sin cookie', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: E2E_CURATOR_USERNAME, password: 'incorrecta' })
      .expect(401);
    expect(res.body).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Usuario o contraseña incorrectos.' } });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('login con body inválido: 400 VALIDATION_ERROR', async () => {
    const res = await request(app.getHttpServer()).post('/auth/login').send({ username: E2E_CURATOR_USERNAME }).expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it('login correcto: cookie httpOnly, SameSite=Lax, Path=/, sin Domain ni Secure fuera de producción, 7 días', async () => {
    const before = Date.now();
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: E2E_CURATOR_USERNAME, password: E2E_CURATOR_PASSWORD })
      .expect(200);

    const cookie = sessionCookieFrom(res);
    expect(cookie).toMatch(/; HttpOnly/i);
    expect(cookie).toMatch(/; SameSite=Lax/i);
    expect(cookie).toMatch(/; Path=\//);
    expect(cookie).toMatch(/; Max-Age=604800/);
    expect(cookie).not.toMatch(/Domain=/i);
    expect(cookie).not.toMatch(/; Secure/i);

    expect(res.body).toEqual({ authenticated: true, expiresAt: expect.any(String) });
    const expiresAt = Date.parse((res.body as { expiresAt: string }).expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 604_800_000);
  });

  it('con cookie de sesión: /episodes 200, /notifications 200 y /auth/session 200', async () => {
    const cookie = await login(app);

    const episodes = await request(app.getHttpServer()).get('/episodes').set('Cookie', cookie).expect(200);
    expect(episodes.body).toEqual([]);
    await request(app.getHttpServer()).get('/notifications').set('Cookie', cookie).expect(200);

    const session = await request(app.getHttpServer()).get('/auth/session').set('Cookie', cookie).expect(200);
    expect(session.body).toEqual({ authenticated: true, expiresAt: expect.any(String) });
  });

  it('logout es público y borra la cookie (mismos atributos, vencida)', async () => {
    const res = await request(app.getHttpServer()).post('/auth/logout').expect(204);
    const cleared = sessionCookieFrom(res);
    expect(cleared).toMatch(/^atd_session=;/);
    expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/; Path=\//);
    expect(cleared).toMatch(/; HttpOnly/i);
    expect(cleared).toMatch(/; SameSite=Lax/i);
  });
});

describe('Auth (e2e) — rate-limit del login', () => {
  let app: INestApplication<App>;

  // App propia: el contador vive en memoria del proceso de la app, así el
  // bloqueo no contamina los otros tests.
  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it(`tras ${LOGIN_RATE_LIMIT.maxFailuresPerClient} fallos responde 429 TOO_MANY_ATTEMPTS (distinto de 401), incluso con la credencial correcta`, async () => {
    for (let i = 0; i < LOGIN_RATE_LIMIT.maxFailuresPerClient; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ username: E2E_CURATOR_USERNAME, password: `incorrecta-${i}` })
        .expect(401);
    }

    const blocked = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: E2E_CURATOR_USERNAME, password: E2E_CURATOR_PASSWORD })
      .expect(429);
    expect(blocked.body).toEqual({ error: { code: 'TOO_MANY_ATTEMPTS', message: expect.any(String) } });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(LOGIN_RATE_LIMIT.windowMs / 1000);
    expect(blocked.headers['set-cookie']).toBeUndefined();
  });
});

describe('Auth (e2e) — rate-limit con logins concurrentes', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // Regresión del review de API-8: con el chequeo y el registro del fallo
  // separados por el await de scrypt, 200 logins concurrentes daban 199 401 y
  // ningún 429.
  it('50 logins incorrectos simultáneos: a lo sumo 5 responden 401 y el resto 429', async () => {
    const server = app.getHttpServer();
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        request(server).post('/auth/login').send({ username: E2E_CURATOR_USERNAME, password: `incorrecta-${i}` }),
      ),
    );
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 0));

    const unauthorized = statuses.filter((s) => s === 401).length;
    const tooMany = statuses.filter((s) => s === 429).length;
    expect(unauthorized).toBeGreaterThan(0);
    expect(unauthorized).toBeLessThanOrEqual(LOGIN_RATE_LIMIT.maxFailuresPerClient);
    expect(unauthorized + tooMany).toBe(50);
  });
});
