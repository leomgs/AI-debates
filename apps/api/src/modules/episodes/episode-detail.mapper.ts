import { Prisma } from "@prisma/client";
import { z } from "zod";
import { createZodDto } from "nestjs-zod";
import { EpisodeStatusSchema } from "./dto/episode-status.schema";
import { CheckpointReasonSchema } from "./dto/checkpoint-reason.schema";

// Shape exacto del include usado por EpisodesService.getEpisodeDetail —
// vive acá (no en episodes.service.ts) para que el mapper y la query que lo
// alimenta no se desincronicen.
export const EPISODE_DETAIL_INCLUDE = {
  usage: true,
  checkpoints: { orderBy: { createdAt: "asc" } },
  // API-1: debatientes primero y el juez al final.
  participants: {
    orderBy: { isJudge: "asc" },
    include: { agent: { select: { name: true, role: true } } },
  },
  debate: {
    include: {
      topic: { select: { id: true, title: true } },
      rounds: {
        orderBy: { round: "asc" },
        include: { arguments: { orderBy: { createdAt: "asc" } } },
      },
      verdict: true,
    },
  },
} satisfies Prisma.EpisodeInclude;

type EpisodeWithDetail = Prisma.EpisodeGetPayload<{ include: typeof EPISODE_DETAIL_INCLUDE }>;

// Zod, no interface plana (spec 001, docs/product/001-openapi-contract-zod.md)
// — para que GET /episodes/:id tenga un @ZodResponse real. Mismo shape
// recortado que ya arma mapEpisodeDetail más abajo, escrito como fuente de
// verdad primero: EpisodeDetailResponse se infiere de este schema, no al
// revés (si mapEpisodeDetail dejara de matchear, tsc lo marca).
export const EpisodeDetailSchema = z.object({
  id: z.string().uuid(),
  status: EpisodeStatusSchema,
  // API-12 (spec 003): hay una ejecución del pipeline en curso en este
  // proceso. Con un estado activo y esto en false, el episodio está trabado
  // hasta que EpisodeRecoveryService lo retome al reiniciar (AC 3.39).
  pipelineActive: z.boolean(),
  // API-1, parte 1 (spec 003, AC 3.26-3.29): cabecera del detalle y nombres
  // de los agentes del timeline y del veredicto. `language` (parte 2) llega
  // con la migración de la spec 004 (tasks.md §13.7).
  topic: z.object({
    id: z.string().uuid(),
    title: z.string(),
  }),
  createdAt: z.iso.datetime(),
  // Vacío hasta que el pipeline selecciona los participantes (al salir de
  // CREATED). `agentId` es el que usan arguments[].agentId, verdict.judgeId
  // y verdict.winnerId. `role` es la persona (ANALYST, CONTRARIAN, ...) o
  // JUDGE; `name`, su nombre visible.
  participants: z.array(
    z.object({
      agentId: z.string().uuid(),
      name: z.string(),
      role: z.string().nullable(),
      isJudge: z.boolean(),
    })
  ),
  usage: z
    .object({
      llmCalls: z.number().int(),
      searchRequests: z.number().int(),
      ttsRequests: z.number().int(),
      executionTime: z.number().int(),
    })
    .nullable(),
  limits: z.object({
    maxLlmCalls: z.number().int(),
    maxSearchQueries: z.number().int(),
    maxTtsSegments: z.number().int(),
  }),
  // string ISO, no z.date() — Zod 4 no puede representar z.date() en JSON
  // Schema (confirmado corriendo openapi:generate a mano, nestjs-zod no
  // expone override). mapEpisodeDetail serializa los Date reales de Prisma.
  checkpoints: z.array(
    z.object({
      fromState: EpisodeStatusSchema,
      reason: CheckpointReasonSchema,
      debateRoundId: z.string().uuid().nullable(),
      createdAt: z.iso.datetime(),
    })
  ),
  debate: z.object({
    rounds: z.array(
      z.object({
        id: z.string().uuid(),
        round: z.number().int(),
        type: z.enum(["OPENING", "REBUTTAL", "CROSS_EXAMINATION"]),
        arguments: z.array(
          z.object({
            id: z.string().uuid(),
            agentId: z.string().uuid(),
            content: z.string(),
            origin: z.enum(["AI_GENERATED", "HUMAN_EDITED"]),
            respondsToId: z.string().uuid().nullable(),
            createdAt: z.iso.datetime(),
          })
        ),
      })
    ),
    verdict: z
      .object({
        id: z.string().uuid(),
        judgeId: z.string().uuid(),
        content: z.string(),
        winnerId: z.string().uuid().nullable(),
        createdAt: z.iso.datetime(),
      })
      .nullable(),
  }),
});

// spec 001 (@ZodResponse) — GET /episodes/:id.
export class EpisodeDetailDto extends createZodDto(EpisodeDetailSchema) {}

// api-contract.md §2 (GET /episodes/:id). `arguments` SOLO expone status
// OFFICIAL — los DRAFT/REJECTED son estado interno de orquestación
// (features.md Feature 2: "los borradores están estrictamente aislados del
// contexto del oponente"), nunca se exponen vía API. Se filtra acá, no se
// confía en que el caller ya haya filtrado.
//
// `pipelineActive` no sale de la base: es estado en memoria del proceso
// (EpisodeEventsService), así que lo resuelve el caller.
export function mapEpisodeDetail(episode: EpisodeWithDetail, runtime: { pipelineActive: boolean }): EpisodeDetailResponse {
  return {
    id: episode.id,
    status: episode.status,
    pipelineActive: runtime.pipelineActive,
    topic: { id: episode.debate.topic.id, title: episode.debate.topic.title },
    createdAt: episode.createdAt.toISOString(),
    participants: episode.participants.map((p) => ({
      agentId: p.agentId,
      name: p.agent.name,
      role: p.agent.role,
      isJudge: p.isJudge,
    })),
    usage: episode.usage
      ? {
          llmCalls: episode.usage.llmCalls,
          searchRequests: episode.usage.searchRequests,
          ttsRequests: episode.usage.ttsRequests,
          executionTime: episode.usage.executionTime,
        }
      : null,
    limits: {
      maxLlmCalls: episode.maxLlmCalls,
      maxSearchQueries: episode.maxSearchQueries,
      maxTtsSegments: episode.maxTtsSegments,
    },
    checkpoints: episode.checkpoints.map((c) => ({
      fromState: c.fromState,
      reason: c.reason,
      debateRoundId: c.debateRoundId,
      createdAt: c.createdAt.toISOString(),
    })),
    debate: {
      rounds: episode.debate.rounds.map((r) => ({
        id: r.id,
        round: r.round,
        type: r.type,
        arguments: r.arguments
          .filter((a) => a.status === "OFFICIAL")
          .map((a) => ({
            id: a.id,
            agentId: a.agentId,
            content: a.content,
            origin: a.origin,
            respondsToId: a.respondsToId,
            createdAt: a.createdAt.toISOString(),
          })),
      })),
      verdict: episode.debate.verdict
        ? {
            id: episode.debate.verdict.id,
            judgeId: episode.debate.verdict.judgeId,
            content: episode.debate.verdict.content,
            winnerId: episode.debate.verdict.winnerId,
            createdAt: episode.debate.verdict.createdAt.toISOString(),
          }
        : null,
    },
  };
}

export type EpisodeDetailResponse = z.infer<typeof EpisodeDetailSchema>;
