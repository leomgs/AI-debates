import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { join, resolve } from 'path';
import type { Request, Response } from 'express';
import { HttpErrorFilter } from './shared/http/http-error.filter';
import type { Env } from './shared/config/env.schema';
import { verifyAudioUrlSignature } from './modules/tts/audio-url-signer';

async function bootstrap() {
  // Cambiamos a NestExpressApplication para acceder a usar Static Assets
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Formato de error HTTP consistente en toda la API (api-contract.md §1,
  // tasks.md §9) — EpisodesModule es el primer módulo con superficie HTTP.
  app.useGlobalFilters(new HttpErrorFilter());

  // Habilitar CORS para que tu frontend de Remotion pueda consultar el backend
  app.enableCors();

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

  await app.listen(3000);
}
bootstrap();