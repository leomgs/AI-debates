import { z } from "zod";

// api-contract.md §2 — GET /episodes?status=A,B,C. El parseo/validación del
// CSV contra EpisodeStatus vive en EpisodesService.parseStatusFilter (ya
// implementado, Fase B) — acá solo se valida el shape del query param en sí.
export const ListEpisodesQuerySchema = z.object({ status: z.string().optional() });
export type ListEpisodesQueryDto = z.infer<typeof ListEpisodesQuerySchema>;
