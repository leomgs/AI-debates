import { Module } from "@nestjs/common";
import { FactCheckService } from "./fact-check.service";

// Sin controller: mismo criterio que Agents/Research/Debate — no expone
// endpoints propios (coding-rules.md §1), lo orquesta EpisodesModule.
@Module({
  providers: [FactCheckService],
  exports: [FactCheckService],
})
export class FactCheckModule {}
