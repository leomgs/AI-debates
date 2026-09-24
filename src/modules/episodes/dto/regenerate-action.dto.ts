import { z } from "zod";
import { createZodDto } from "nestjs-zod";

// api-contract.md §3 — POST /episodes/:id/actions/regenerate
export const RegenerateActionSchema = z.object({ argumentId: z.string().uuid() }).strict();
export class RegenerateActionDto extends createZodDto(RegenerateActionSchema) {}
