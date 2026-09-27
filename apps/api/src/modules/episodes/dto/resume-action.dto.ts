import { z } from "zod";
import { createZodDto } from "nestjs-zod";

// api-contract.md §3 — POST /episodes/:id/actions/resume. El shape del body
// depende de checkpoint.reason (leído del EpisodeCheckpoint activo, no del
// request) — unión discriminada por forma, no por un campo explícito, porque
// el cliente no manda el reason, solo los datos que le corresponden.
// EpisodeActionsService valida además que el shape recibido matchee el
// reason real del checkpoint (un body USAGE_LIMIT_EXCEEDED válido pero
// mandado para un checkpoint INSUFFICIENT_EVIDENCE igual se rechaza ahí).
export const UsageLimitResumeSchema = z
  .object({
    maxLlmCalls: z.number().int().positive().optional(),
    maxSearchQueries: z.number().int().positive().optional(),
  })
  .strict()
  .refine((v) => v.maxLlmCalls !== undefined || v.maxSearchQueries !== undefined, {
    message: "Debe incluir al menos maxLlmCalls o maxSearchQueries",
  })
  .meta({ id: "UsageLimitResumeBody" });

export const InsufficientEvidenceResumeSchema = z
  .object({
    manualSources: z
      .array(
        z.object({
          url: z.string().url(),
          title: z.string().min(1),
          snippet: z.string().min(1),
        })
      )
      .min(1),
  })
  .strict()
  .meta({ id: "InsufficientEvidenceResumeBody" });

// MAX_REVISIONS_EXCEEDED, VALIDATION_INCONSISTENCY, PROVIDER_QUOTA_EXCEEDED y
// VOICE_NOT_CONFIGURED: no hay nada que el curador pueda mandar.
export const EmptyResumeSchema = z.object({}).strict().meta({ id: "EmptyResumeBody" });

export const ResumeActionBodySchema = z.union([
  UsageLimitResumeSchema,
  InsufficientEvidenceResumeSchema,
  EmptyResumeSchema,
]);
export type ResumeActionBody = z.infer<typeof ResumeActionBodySchema>;

// API-10 (spec 003): documenta el body de resume en openapi.json como la
// unión de los 3 schemas de arriba (anyOf de UsageLimitResumeBody,
// InsufficientEvidenceResumeBody y EmptyResumeBody, nombrados con
// .meta({ id }) para que el dashboard los tome de components.schemas).
// createZodDto sí genera el JSON Schema de una unión (nestjs-zod la envuelve
// en un "root" y cleanupOpenApiDoc la desenvuelve); el límite era solo de
// tipos: TS no deja hacer `extends` sobre una clase cuya instancia es una
// unión (TS2509). El cast a un constructor de `object` lo evita sin cambiar
// nada en runtime (los estáticos de createZodDto se heredan igual). La clase
// solo se usa en @ApiBody: el controller valida el body con
// ResumeActionBodySchema y lo tipa como ResumeActionBody. Qué rama
// corresponde depende del `reason` del checkpoint activo, que el cliente lee
// de GET /episodes/:id; EpisodeActionsService la vuelve a validar contra ese
// reason.
export class ResumeActionBodyDto extends (createZodDto(ResumeActionBodySchema) as unknown as new () => object) {}
