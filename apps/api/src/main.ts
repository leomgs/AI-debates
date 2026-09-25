import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { join, resolve } from 'path';
import type { Request, Response } from 'express';
import { HttpErrorFilter } from './shared/http/http-error.filter';
import type { Env } from './shared/config/env.schema';
import { verifyAudioUrlSignature } from './modules/tts/audio-url-signer';
import { buildOpenApiDocument } from './shared/http/openapi-document';
import { SESSION_COOKIE_NAME } from './modules/auth/session-cookie';

async function bootstrap() {
  // Cambiamos a NestExpressApplication para acceder a usar Static Assets
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Formato de error HTTP consistente en toda la API (api-contract.md §1,
  // tasks.md §9) — EpisodesModule es el primer módulo con superficie HTTP.
  app.useGlobalFilters(new HttpErrorFilter());

  // API-8 (ADR 0001 punto 3): la API queda detrás del rewrite de Next, único
  // origen público, así que no hay CORS (el enableCors() abierto que había
  // se quitó) y se confía en exactamente UN proxy delante: req.ip sale del
  // último salto de X-Forwarded-For, no del primero (que con `true` quedaría
  // en manos del cliente). Ojo: el rewrite de Next 16 no agrega
  // X-Forwarded-For por su cuenta, así que req.ip no identifica al cliente de
  // forma confiable; por eso el rate-limit del login tiene además un techo
  // global (LoginRateLimiterService).
  app.set('trust proxy', 1);

  // Servir la carpeta pública
  app.useStaticAssets(join(__dirname, '..', 'public'), {
    prefix: '/public/',
  });

  // AC 6.1 (features.md Feature 6, etapa 3 de TTS — tasks.md sección 5):
  // servir los audios de LocalDiskStorageProvider bajo la URL firmada que
  // devuelve getSignedUrl(). useStaticAssets no soporta un guard propio, así
  // que la verificación va en un middleware montado antes — TtsModule sigue
  // sin controller propio (coding-rules.md §1), esto es infraestructura de
  // bootstrap, mismo nivel que el mount de /public/ de arriba.
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const audioStorageDir = resolve(config.get('AUDIO_STORAGE_DIR', { infer: true }));
  const audioSigningSecret = config.get('AUDIO_SIGNING_SECRET', { infer: true });

  // NODE_ENV es requerida (EnvSchema) y decide cookie Secure, /docs y el
  // secreto de audio: se loguea el valor efectivo para que un despliegue mal
  // configurado se vea en el primer renglón del log.
  new Logger('Bootstrap').log(`NODE_ENV=${config.get('NODE_ENV', { infer: true })}`);
  app.use('/audio-files', (req: Request, res: Response, next: () => void) => {
    const storageKey = decodeURIComponent(req.path.replace(/^\//, ''));
    const expiresAt = Number(req.query.expires);
    const sig = String(req.query.sig ?? '');
    if (!verifyAudioUrlSignature(audioSigningSecret, storageKey, expiresAt, sig)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'URL de audio inválida o expirada.' } });
      return;
    }
    next();
  });
  app.useStaticAssets(audioStorageDir, { prefix: '/audio-files/' });

  // spec 001 (docs/product/001-openapi-contract-zod.md) — /docs navegable,
  // mismo documento que escribe scripts/generate-openapi.ts a openapi.json.
  // Solo fuera de producción (spec 003, D20): Swagger es middleware, queda
  // fuera del SessionGuard y expondría la superficie completa de la API; el
  // contrato ya vive commiteado en openapi.json, que no depende de este
  // montaje.
  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app, SESSION_COOKIE_NAME));
  }

  await app.listen(3000);
}
bootstrap();