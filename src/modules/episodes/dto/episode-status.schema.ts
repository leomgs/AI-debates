import { z } from "zod";

// Valores exactos de schema.prisma:EpisodeStatus — única fuente para no
// repetir el enum a mano en cada DTO que lo necesite.
export const EpisodeStatusSchema = z.enum([
  "CREATED",
  "RESEARCHING",
  "READY_FOR_DEBATE",
  "DEBATING",
  "JUDGING",
  "PENDING_REVIEW",
  "APPROVED",
  "CANCELLED",
  "FAILED",
  "GENERATING_AUDIO",
  "READY_FOR_RENDER",
  "RENDERING",
  "COMPLETED",
  "REQUIRES_HUMAN_REVIEW",
]);
