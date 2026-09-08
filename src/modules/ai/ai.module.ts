import { Global, Module } from "@nestjs/common";
import { ModelProviderFactory } from "./model-provider.factory";

// Global, igual que PrismaModule — cualquier módulo de dominio que necesite
// resolver un modelo LLM lo inyecta sin tener que importar AiModule explícito
// en cada feature module.
@Global()
@Module({
  providers: [ModelProviderFactory],
  exports: [ModelProviderFactory],
})
export class AiModule {}
