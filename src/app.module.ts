import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './shared/config/env.schema';
import { PrismaModule } from './shared/prisma/prisma.module';
import { AiModule } from './modules/ai/ai.module';
import { AgentsModule } from './modules/agents/agents.module';
import { ResearchModule } from './modules/research/research.module';
import { DebateModule } from './modules/debate/debate.module';
import { FactCheckModule } from './modules/fact-check/fact-check.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AiModule,
    AgentsModule,
    ResearchModule,
    DebateModule,
    FactCheckModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
