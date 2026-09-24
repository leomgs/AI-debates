import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

// Global, igual que AiModule — cualquier módulo de dominio que necesite
// PrismaService lo inyecta sin tener que importar PrismaModule explícito
// en cada feature module.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
