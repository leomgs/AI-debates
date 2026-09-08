import { Module } from "@nestjs/common";
import { DebateService } from "./debate.service";

// Sin controller: mismo criterio que AgentsModule/ResearchModule — no expone
// endpoints propios (coding-rules.md §1), lo orquesta EpisodesModule.
@Module({
  providers: [DebateService],
  exports: [DebateService],
})
export class DebateModule {}
