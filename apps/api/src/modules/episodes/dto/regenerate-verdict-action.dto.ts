import { z } from "zod";

// api-contract.md §3 — POST /episodes/:id/actions/regenerate-verdict (spec
// 003, API-19). Body vacío y estricto: la acción no tiene parámetros, pero
// un campo de más es un error del cliente, no algo a ignorar. Sin clase
// createZodDto: EpisodeActionsService.regenerateVerdict no recibe body.
export const RegenerateVerdictActionSchema = z.object({}).strict();
