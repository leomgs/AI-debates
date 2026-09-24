import { Module } from '@nestjs/common';
import { AgentsService } from './agents.service';

// Sin controller: AgentsModule no expone endpoints (coding-rules.md §1) —
// solo un servicio que EpisodesModule (o quien orqueste el debate) consume.
@Module({
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
