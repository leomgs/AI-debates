import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { HttpErrorFilter } from './shared/http/http-error.filter';

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

  await app.listen(3000);
}
bootstrap();