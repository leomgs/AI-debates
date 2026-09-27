import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { EpisodeStatusSchema } from "./episode-status.schema";

// Mismo formato que acepta EpisodesService.parseStatusFilter: valores de
// EpisodeStatus separados por coma, con espacios opcionales alrededor de
// cada uno; vacío = sin filtro.
const STATUS_VALUE = `(?:${EpisodeStatusSchema.options.join("|")})`;
const STATUS_CSV_PATTERN = `^(?:\\s*${STATUS_VALUE}\\s*(?:,\\s*${STATUS_VALUE}\\s*)*)?$`;

// api-contract.md §2 — GET /episodes?status=A,B,C. El parseo/validación del
// CSV contra EpisodeStatus vive en EpisodesService.parseStatusFilter (ya
// implementado, Fase B) — acá solo se valida el shape del query param en sí.
//
// API-10: la descripción y el `pattern` son solo documentación (salen de
// .meta(), Zod no los valida acá), para que openapi.json diga qué valores
// acepta sin cambiar la validación ni el mensaje de error de
// parseStatusFilter (400 VALIDATION_ERROR). Sigue tipado como string, no
// como array de EpisodeStatus: un array en query se documenta con
// style: form + explode: false para el formato A,B, y openapi-fetch por
// defecto lo serializa como status=A&status=B, que esta API rechaza. El
// dashboard ya manda el CSV armado como string.
export const ListEpisodesQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .meta({
      description:
        "Filtro por estado: valores de EpisodeStatus separados por coma (por ejemplo `PENDING_REVIEW,REQUIRES_HUMAN_REVIEW`). " +
        "Un valor que no es un EpisodeStatus es 400 `VALIDATION_ERROR`.",
      pattern: STATUS_CSV_PATTERN,
    }),
});
export class ListEpisodesQueryDto extends createZodDto(ListEpisodesQuerySchema) {}
