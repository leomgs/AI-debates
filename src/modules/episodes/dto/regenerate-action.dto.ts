import { z } from "zod";

// api-contract.md §3 — POST /episodes/:id/actions/regenerate
export const RegenerateActionSchema = z.object({ argumentId: z.string().uuid() }).strict();
export type RegenerateActionDto = z.infer<typeof RegenerateActionSchema>;
