import { Module } from "@nestjs/common";
import { ResearchService } from "./research.service";
import { TavilyProvider } from "./tavily.provider";

// Sin controller: igual que AgentsModule, no expone endpoints propios
// (coding-rules.md §1) — lo orquesta EpisodesModule.
@Module({
  providers: [ResearchService, TavilyProvider],
  exports: [ResearchService],
})
export class ResearchModule {}
