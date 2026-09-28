import type { EpisodeDetail } from "@/lib/episode-detail";

// Detalle de episodio para los tests de la lógica del detalle y de la vista
// en vivo. Con el tipo generado de openapi.json: si el contrato cambia, el
// fixture deja de compilar.

export const AGENT_A = "00000000-0000-4000-8000-00000000000a";
export const AGENT_B = "00000000-0000-4000-8000-00000000000b";
export const JUDGE = "00000000-0000-4000-8000-00000000000c";

export function makeEpisodeDetail(overrides: Partial<EpisodeDetail> = {}): EpisodeDetail {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    status: "DEBATING",
    pipelineActive: true,
    topic: { id: "00000000-0000-4000-8000-000000000002", title: "¿La IA reemplaza a los programadores?" },
    language: "ES",
    createdAt: "2026-09-28T10:00:00.000Z",
    publishedAt: null,
    participants: [
      { agentId: AGENT_A, name: "Analista", role: "ANALYST", isJudge: false },
      { agentId: AGENT_B, name: "Contrarian", role: "CONTRARIAN", isJudge: false },
      { agentId: JUDGE, name: "Juez", role: "JUDGE", isJudge: true },
    ],
    usage: { llmCalls: 4, searchRequests: 1, ttsRequests: 0, executionTime: 65_000 },
    limits: { maxLlmCalls: 30, maxSearchQueries: 5, maxTtsSegments: 20 },
    checkpoints: [],
    debate: { rounds: [], verdict: null },
    ...overrides,
  };
}
