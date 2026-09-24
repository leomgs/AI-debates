import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './shared/config/env.schema';
import { PrismaModule } from './shared/prisma/prisma.module';
import { AiModule } from './modules/ai/ai.module';
import { AgentsModule } from './modules/agents/agents.module';
import { ResearchModule } from './modules/research/research.module';
import { DebateModule } from './modules/debate/debate.module';
import { FactCheckModule } from './modules/fact-check/fact-check.module';
import { EpisodesModule } from './modules/episodes/episodes.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AiModule,
    AgentsModule,
    ResearchModule,
    DebateModule,
    FactCheckModule,
    // NotificationsModule llega transitivo vía EpisodesModule (que lo
    // importa para inyectar NotificationsService en EpisodeStateService) —
    // no hace falta importarlo acá aparte.
    EpisodesModule,
  ],
  controllers: [AppController],
  // spec 001 (docs/product/001-openapi-contract-zod.md) — reemplaza el pipe
  // propio del proyecto (shared/http/zod-validation.pipe.ts, borrado): valida
  // automáticamente cualquier @Body()/@Query() tipado con una clase
  // createZodDto. Path params sueltos (no DTOs de objeto) siguen
  // instanciándolo a mano donde hace falta (mismo pipe, ver
  // EpisodesController.runAction).
  providers: [AppService, { provide: APP_PIPE, useClass: ZodValidationPipe }],
})
export class AppModule {}
