import { z } from "zod";

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
  });

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
  .strict();

export const EmptyResumeSchema = z.object({}).strict();

export const ResumeActionBodySchema = z.union([
  UsageLimitResumeSchema,
  InsufficientEvidenceResumeSchema,
  EmptyResumeSchema,
]);
export type ResumeActionBody = z.infer<typeof ResumeActionBodySchema>;

// Sin ResumeActionBodyDto (createZodDto): TS no permite `extends` sobre un
// schema cuyo tipo de salida es una unión (error TS2509, "constructor
// return type... is not an object type") — createZodDto solo envuelve
// shapes de un único tipo objeto. No hace falta igual: el body real de
// POST /episodes/:id/actions/resume se sigue validando a mano con
// ResumeActionBodySchema.parse() en EpisodesController.runAction (el shape
// esperado depende del `reason` del checkpoint activo, no del endpoint en
// sí — el pipe global de nestjs-zod no podría resolver esa polimorfia por
// action de todos modos). Spec 001 documenta esto como fuera del alcance de
// @ZodResponse de esta primera pasada.
