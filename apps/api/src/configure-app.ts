import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { join, resolve } from 'path';
import type { Request, Response } from 'express';
import { HttpErrorFilter } from './shared/http/http-error.filter';
import type { ErrorResponse } from './shared/http/error-response.dto';
import type { Env } from './shared/config/env.schema';
import { verifyAudioUrlSignature } from './modules/tts/audio-url-signer';
import { buildOpenApiDocument } from './shared/http/openapi-document';
import { SESSION_COOKIE_NAME } from './modules/auth/session-cookie';

// Todo el wiring HTTP de la app que no es un módulo de Nest (filter global,
// trust proxy, estáticos, /audio-files, Swagger). Extraído de main.ts para
// que los tests e2e levanten exactamente la misma app que bootstrap() en vez
// de reimplementar a mano partes del bootstrap (review de API-8). No escucha:
// eso queda en main.ts.
export function configureApp(app: NestExpressApplication, config: ConfigService<Env, true>): void {
  // Formato de error HTTP consistente en toda la API (api-contract.md §1,
  // tasks.md §9) — EpisodesModule es el primer módulo con superficie HTTP.
  app.useGlobalFilters(new HttpErrorFilter());

  // API-8 (ADR 0001 punto 3): la API queda detrás del rewrite de Next, único
  // origen público, así que no hay CORS (el enableCors() abierto que había
  // se quitó) y se confía en exactamente UN proxy delante: req.ip sale del
  // último salto de X-Forwarded-For, no del primero (que con `true` quedaría
  // en manos del cliente). Condición de despliegue (setup.md, "Despliegue"):
  // el proxy de borde tiene que AGREGAR X-Forwarded-For y Next reenviarlo; el
  // rewrite de Next 16 no lo agrega por su cuenta. Si no se cumple, req.ip lo
  // controla el cliente y lo único que protege el login es el techo global
  // del rate-limit (LoginRateLimiterService).
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
  const audioStorageDir = resolve(config.get('AUDIO_STORAGE_DIR', { infer: true }));
  const audioSigningSecret = config.get('AUDIO_SIGNING_SECRET', { infer: true });
  app.use('/audio-files', (req: Request, res: Response, next: () => void) => {
    const storageKey = decodeURIComponent(req.path.replace(/^\//, ''));
    const expiresAt = Number(req.query.expires);
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
    if (!verifyAudioUrlSignature(audioSigningSecret, storageKey, expiresAt, sig)) {
      // Fuera de Nest (no pasa por HttpErrorFilter): `satisfies` ata el code
      // al mismo enum que documenta openapi.json (API-10).
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: 'URL de audio inválida o expirada.' },
      } satisfies ErrorResponse);
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
}
