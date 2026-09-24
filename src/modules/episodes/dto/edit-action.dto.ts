import { z } from "zod";
import { createZodDto } from "nestjs-zod";

// api-contract.md §3 — POST /episodes/:id/actions/edit
export const EditActionSchema = z
  .object({ argumentId: z.string().uuid(), content: z.string().min(1) })
  .strict();
export class EditActionDto extends createZodDto(EditActionSchema) {}
