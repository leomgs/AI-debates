import { z } from "zod";

// Valores exactos de schema.prisma:CheckpointReason — mismo criterio que
// episode-status.schema.ts, única fuente para no repetir el enum a mano.
export const CheckpointReasonSchema = z.enum([
  "INSUFFICIENT_EVIDENCE",
  "USAGE_LIMIT_EXCEEDED",
  "MAX_REVISIONS_EXCEEDED",
  "VALIDATION_INCONSISTENCY",
  "PROVIDER_QUOTA_EXCEEDED",
  "VOICE_NOT_CONFIGURED",
]);
