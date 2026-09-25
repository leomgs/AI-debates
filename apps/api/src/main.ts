import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { Env } from './shared/config/env.schema';
import { configureApp } from './configure-app';

async function bootstrap() {
  // NestExpressApplication para poder servir estáticos (configure-app.ts).
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const logger = new Logger('Bootstrap');

  // NODE_ENV es requerida (EnvSchema) y decide cookie Secure, /docs y el
  // secreto de audio: se loguea el valor efectivo para que un despliegue mal
  // configurado se vea en el primer renglón del log.
  logger.log(`NODE_ENV=${config.get('NODE_ENV', { infer: true })}`);

  configureApp(app, config);

  // HOST por defecto 127.0.0.1 (review de API-8): la API no se expone
  // directo, solo la alcanza el rewrite de Next (ADR 0001 punto 3). Si Next
  // corre en otra máquina o contenedor, HOST tiene que ser una interfaz que
  // Next alcance (por ejemplo 0.0.0.0 dentro de una red privada).
  const host = config.get('HOST', { infer: true });
  const port = config.get('PORT', { infer: true });
  await app.listen(port, host);
  logger.log(`Escuchando en http://${host}:${port}`);
}
void bootstrap();
