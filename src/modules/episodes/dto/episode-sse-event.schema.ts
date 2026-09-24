import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { EpisodeStatusSchema } from "./episode-status.schema";
import { CheckpointReasonSchema } from "./checkpoint-reason.schema";

// Feature 8 (features.md) — GET /episodes/:id/events. Payloads escritos
// contra lo que el código real emite (episode-orchestrator.service.ts
// `emitEvent`, episode-state.service.ts), no contra la prosa original de
// features.md, que estaba desactualizada en 2 puntos (spec 001, hallazgo 4,
// decision-log.md): fact_check.completed usa status "PASSED"/"FAILED", no
// "TRUE"/"FALSE"; argument.approved no incluye sequenceIndex.
//
// OpenAPI no modela streams SSE — este schema es un envelope sintético
// { type, data } para documentar en components.schemas qué payload
// corresponde a cada `event:` de la respuesta text/event-stream real (el
// wire format real es SSE, no un único objeto JSON con esta forma).
export const EpisodeSseEventTypeSchema = z.enum([
  "research.started",
  "agent.thinking",
  "fact_check.completed",
  "argument.approved",
  "episode.pending_review",
  "episode.requires_review",
]);

// Sin campo `data` (no z.undefined().optional(): Zod 4 tampoco puede
// representar undefined en JSON Schema, mismo motivo que z.date() más
// abajo) — research.started/episode.pending_review se emiten sin payload,
// así que el shape correcto es directamente no tener la propiedad.
export const ResearchStartedEventSchema = z.object({
  type: z.literal("research.started"),
});

export const AgentThinkingEventSchema = z.object({
  type: z.literal("agent.thinking"),
  data: z.object({
    agentId: z.string().uuid(),
    round: z.number().int().positive(),
  }),
});

export const FactCheckCompletedEventSchema = z.object({
  type: z.literal("fact_check.completed"),
  data: z.object({
    status: z.enum(["PASSED", "FAILED"]),
    errorsDetected: z.number().int().nonnegative(),
  }),
});

export const ArgumentApprovedEventSchema = z.object({
  type: z.literal("argument.approved"),
  data: z.object({
    agentId: z.string().uuid(),
    text: z.string(),
  }),
});

export const EpisodePendingReviewEventSchema = z.object({
  type: z.literal("episode.pending_review"),
});

export const EpisodeRequiresReviewEventSchema = z.object({
  type: z.literal("episode.requires_review"),
  data: z.object({
    reason: CheckpointReasonSchema,
    checkpoint: z.object({
      fromState: EpisodeStatusSchema,
      reason: CheckpointReasonSchema,
      debateRoundId: z.string().uuid().nullable(),
      // string ISO, no z.date() (mismo motivo que episode.schema.ts /
      // episode-detail.mapper.ts). EpisodeEventsService.emit() no valida
      // contra este schema en runtime (solo documenta) — el Date real que
      // arma EpisodeStateService.requireHumanReview() viaja tal cual y
      // Express lo serializa a ISO al armar el frame SSE, mismo resultado
      // final igual.
      createdAt: z.iso.datetime(),
    }),
  }),
});

// Unión para uso interno/type-checking — NO se registra en el OpenAPI vía
// createZodDto: TS2509, "constructor return type... is not an object type",
// misma limitación que ResumeActionBodySchema (createZodDto no envuelve
// z.union/z.discriminatedUnion). Para components.schemas se registran los
// 6 schemas individuales de arriba en su lugar, cada uno con su propio DTO.
export const EpisodeSseEventSchema = z.discriminatedUnion("type", [
  ResearchStartedEventSchema,
  AgentThinkingEventSchema,
  FactCheckCompletedEventSchema,
  ArgumentApprovedEventSchema,
  EpisodePendingReviewEventSchema,
  EpisodeRequiresReviewEventSchema,
]);

// Para que aterricen en components.schemas del openapi.json (restricción
// técnica de la spec 001) — GET /episodes/:id/events documenta su
// content-type text/event-stream a mano (OpenAPI no modela SSE); estos 6
// DTOs se registran vía @ApiExtraModels en EpisodesController para que
// queden nombrados en el documento sin atarlos a ningún @ZodResponse (el
// wire format real es SSE, no un objeto JSON con esta forma).
export class ResearchStartedEventDto extends createZodDto(ResearchStartedEventSchema) {}
export class AgentThinkingEventDto extends createZodDto(AgentThinkingEventSchema) {}
export class FactCheckCompletedEventDto extends createZodDto(FactCheckCompletedEventSchema) {}
export class ArgumentApprovedEventDto extends createZodDto(ArgumentApprovedEventSchema) {}
export class EpisodePendingReviewEventDto extends createZodDto(EpisodePendingReviewEventSchema) {}
export class EpisodeRequiresReviewEventDto extends createZodDto(EpisodeRequiresReviewEventSchema) {}
