import { z } from "zod";
import { createZodDto } from "nestjs-zod";

// api-contract.md §3 — POST /episodes/:id/actions/regenerate-verdict (spec
// 003, API-19). Body vacío y estricto: la acción no tiene parámetros, pero
// un campo de más es un error del cliente, no algo a ignorar. Sin body (o
// con un campo de más) → 400 VALIDATION_ERROR en el pipe global.
// EpisodeActionsService.regenerateVerdict no recibe body: el DTO existe para
// validarlo y para que openapi.json documente `{}` (API-10).
export const RegenerateVerdictActionSchema = z.object({}).strict();
export class RegenerateVerdictActionDto extends createZodDto(RegenerateVerdictActionSchema) {}
