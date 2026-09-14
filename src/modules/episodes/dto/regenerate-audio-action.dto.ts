import { z } from "zod";

// api-contract.md §3 — POST /episodes/:id/actions/regenerate-audio (AC 6.2).
// sequenceIndex es 1-based, mismo orden que getOrderedOfficialArguments
// (createdAt asc) — decision-log.md 2026-09-09 #20 punto 3.
export const RegenerateAudioActionSchema = z.object({ sequenceIndex: z.number().int().positive() }).strict();
export type RegenerateAudioActionDto = z.infer<typeof RegenerateAudioActionSchema>;
