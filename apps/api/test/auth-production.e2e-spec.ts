// Primero, a propósito: fija NODE_ENV=production antes de importar AppModule.
import './e2e-production-env';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';
import type { Env } from './../src/shared/config/env.schema';
import { E2E_CURATOR_PASSWORD, E2E_CURATOR_USERNAME } from './e2e-auth.fixture';

// API-8 con NODE_ENV=production (review de API-8): /docs sin montar (D20),
// cookie Secure y sin CORS. NODE_ENV lo fija e2e-production-env.ts, que se
// importa antes que AppModule.

describe('Auth (e2e) — NODE_ENV=production', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const expressApp = moduleFixture.createNestApplication<NestExpressApplication>();
    const config = expressApp.get<ConfigService<Env, true>>(ConfigService);
    expect(config.get('NODE_ENV', { infer: true })).toBe('production');
    configureApp(expressApp, config);
    await expressApp.init();
    app = expressApp;
  });

  afterAll(async () => {
    await app.close();
  });

  it('/docs no está montado: 404', async () => {
    await request(app.getHttpServer()).get('/docs').expect(404);
    await request(app.getHttpServer()).get('/docs-json').expect(404);
  });

  it('la cookie de login lleva Secure (además de HttpOnly y SameSite=Lax)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: E2E_CURATOR_USERNAME, password: E2E_CURATOR_PASSWORD })
      .expect(200);
    const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('atd_session='));
    expect(cookie).toMatch(/; Secure/);
    expect(cookie).toMatch(/; HttpOnly/i);
    expect(cookie).toMatch(/; SameSite=Lax/i);
  });

  it('no hay CORS: ni el preflight ni una respuesta normal traen Access-Control-Allow-Origin', async () => {
    const preflight = await request(app.getHttpServer())
      .options('/episodes')
      .set('Origin', 'http://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();

    const normal = await request(app.getHttpServer()).get('/').set('Origin', 'http://evil.example').expect(200);
    expect(normal.headers['access-control-allow-origin']).toBeUndefined();
  });
});
