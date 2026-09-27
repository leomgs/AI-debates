import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { DebateLanguageSchema } from "@ai-trend-debates/contracts";

// api-contract.md §2 — POST /episodes. DTO HTTP separado de
// shared/contracts/agents.contracts.ts (coding-rules.md §3).
//
// Spec 004 (AC 4.1, 4.2): `language` opcional, default ES. Un valor fuera
// del enum es 400 VALIDATION_ERROR en el pipe global, antes de llegar al
// service: ni el chequeo de voces (409 VOICE_NOT_CONFIGURED) ni ningún
// insert corren (orden de D15). Es el único lugar donde se elige el idioma:
// ninguna acción lo acepta (AC 4.3).
export const CreateEpisodeSchema = z
  .object({
    topic: z.string().min(1).max(300),
    language: DebateLanguageSchema.default("ES"),
  })
  .strict();
export class CreateEpisodeDto extends createZodDto(CreateEpisodeSchema) {}
