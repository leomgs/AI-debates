import { z } from "zod";
import { createZodDto } from "nestjs-zod";

// api-contract.md §2 — POST /episodes. DTO HTTP separado de
// shared/contracts/agents.contracts.ts (coding-rules.md §3).
export const CreateEpisodeSchema = z.object({ topic: z.string().min(1).max(300) }).strict();
export class CreateEpisodeDto extends createZodDto(CreateEpisodeSchema) {}
