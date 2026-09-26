import { z } from "zod";

// api-contract.md §3/§5 — acciones de curaduría válidas. `regenerate-audio`
// (etapa 3 de TTS, AC 6.2) se suma a las 5 originales — a diferencia de esas,
// solo es válida desde READY_FOR_RENDER, no PENDING_REVIEW (ver tabla §5).
// `regenerate-verdict` (spec 003, API-19): volver a juzgar, solo en
// PENDING_REVIEW.
export const ActionNameSchema = z.enum([
  "approve",
  "edit",
  "regenerate",
  "reject",
  "resume",
  "regenerate-audio",
  "regenerate-verdict",
]);
export type ActionName = z.infer<typeof ActionNameSchema>;
