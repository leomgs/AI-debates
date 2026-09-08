import { Prisma } from "@prisma/client";

// Shape exacto del include usado por EpisodesService.getEpisodeDetail —
// vive acá (no en episodes.service.ts) para que el mapper y la query que lo
// alimenta no se desincronicen.
export const EPISODE_DETAIL_INCLUDE = {
  usage: true,
  checkpoints: { orderBy: { createdAt: "asc" } },
  debate: {
    include: {
      rounds: {
        orderBy: { round: "asc" },
        include: { arguments: { orderBy: { createdAt: "asc" } } },
      },
      verdict: true,
    },
  },
} satisfies Prisma.EpisodeInclude;

type EpisodeWithDetail = Prisma.EpisodeGetPayload<{ include: typeof EPISODE_DETAIL_INCLUDE }>;

// api-contract.md §2 (GET /episodes/:id). `arguments` SOLO expone status
// OFFICIAL — los DRAFT/REJECTED son estado interno de orquestación
// (features.md Feature 2: "los borradores están estrictamente aislados del
// contexto del oponente"), nunca se exponen vía API. Se filtra acá, no se
// confía en que el caller ya haya filtrado.
export function mapEpisodeDetail(episode: EpisodeWithDetail) {
  return {
    id: episode.id,
    status: episode.status,
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
      createdAt: c.createdAt,
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
            createdAt: a.createdAt,
          })),
      })),
      verdict: episode.debate.verdict
        ? {
            id: episode.debate.verdict.id,
            judgeId: episode.debate.verdict.judgeId,
            content: episode.debate.verdict.content,
            winnerId: episode.debate.verdict.winnerId,
            createdAt: episode.debate.verdict.createdAt,
          }
        : null,
    },
  };
}

export type EpisodeDetailResponse = ReturnType<typeof mapEpisodeDetail>;
