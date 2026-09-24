import { Module } from "@nestjs/common";
import { RenderService } from "./render.service";

// Sin controller propio (coding-rules.md §1) — GET /episodes/:id/manifest
// vive en EpisodesController, mismo criterio que AC 6.1/6.2 de TtsModule.
// RenderService es puro (sin Prisma, sin otro módulo de dominio inyectado)
// — EpisodesService arma su input y resuelve las URLs firmadas después
// (architecture.md §3, "ningún módulo de dominio importa a otro").
@Module({
  providers: [RenderService],
  exports: [RenderService],
})
export class RenderModule {}
