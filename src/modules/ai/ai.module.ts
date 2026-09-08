import { Global, Module } from "@nestjs/common";
import { ModelProviderFactory } from "./model-provider.factory";
import { LlmRateLimiterService } from "./llm-rate-limiter.service";

// Global, igual que PrismaModule — cualquier módulo de dominio que necesite
// resolver un modelo LLM (o pasar por el rate limiter proactivo antes de
// llamarlo) lo inyecta sin tener que importar AiModule explícito en cada
// feature module.
@Global()
@Module({
  providers: [ModelProviderFactory, LlmRateLimiterService],
  exports: [ModelProviderFactory, LlmRateLimiterService],
})
export class AiModule {}
