import { describe, expect, it } from "vitest";
import { AGENT_A, AGENT_B, JUDGE, makeEpisodeDetail } from "@/test/episode-detail-fixture";
import { CHECKPOINT_REASON_LABELS, checkpointReasonLabel } from "./checkpoint-reasons";
import { debateLanguageTag } from "./debate-language";
import {
  agentName,
  checkpointRound,
  excerpt,
  hasPreview,
  indexArguments,
  latestCheckpoint,
  roundLabel,
  showStaleVerdictWarning,
  sortCheckpoints,
  sortRounds,
  verdictParties,
  type Checkpoint,
  type DebateRound,
  type Verdict,
} from "./episode-detail";
import { EPISODE_STATUSES } from "./episode-status";

const { participants } = makeEpisodeDetail();

function round(id: string, number: number, type: DebateRound["type"], argumentIds: string[] = []): DebateRound {
  return {
    id,
    round: number,
    type,
    arguments: argumentIds.map((argumentId) => ({
      id: argumentId,
      agentId: AGENT_A,
      content: `Contenido ${argumentId}`,
      origin: "AI_GENERATED",
      respondsToId: null,
      createdAt: "2026-09-28T10:00:00.000Z",
    })),
  };
}

function verdict(overrides: Partial<Verdict> = {}): Verdict {
  return {
    id: "v1",
    judgeId: JUDGE,
    content: "El analista gana.",
    winnerId: AGENT_A,
    createdAt: "2026-09-28T11:00:00.000Z",
    stale: false,
    ...overrides,
  };
}

function checkpoint(createdAt: string, overrides: Partial<Checkpoint> = {}): Checkpoint {
  return { fromState: "DEBATING", reason: "MAX_REVISIONS_EXCEEDED", debateRoundId: null, createdAt, ...overrides };
}

describe("timeline (AC 3.27, AC 3.28)", () => {
  it("ordena las rondas por número y las rotula en español", () => {
    const rounds = sortRounds([round("r3", 3, "CROSS_EXAMINATION"), round("r1", 1, "OPENING"), round("r2", 2, "REBUTTAL")]);
    expect(rounds.map(roundLabel)).toEqual(["Ronda 1 · Apertura", "Ronda 2 · Réplica", "Ronda 3 · Contrainterrogatorio"]);
  });

  it("resuelve el nombre del agente, con un respaldo si no está entre los participantes", () => {
    expect(agentName(participants, AGENT_B)).toBe("Contrarian");
    expect(agentName(participants, "otro")).toBe("Agente desconocido");
  });

  it("indexa todos los argumentos del debate por id para resolver respondsToId", () => {
    const index = indexArguments([round("r1", 1, "OPENING", ["a1", "a2"]), round("r2", 2, "CROSS_EXAMINATION", ["a3"])]);
    expect([...index.keys()]).toEqual(["a1", "a2", "a3"]);
  });

  it("extracto en una línea, cortado en un espacio con …", () => {
    expect(excerpt("Corto")).toBe("Corto");
    expect(excerpt("uno\n\ndos   tres")).toBe("uno dos tres");
    expect(excerpt("palabra ".repeat(10), 20)).toBe("palabra palabra…");
  });
});

describe("veredicto (AC 3.29, AC 3.81)", () => {
  it("juez por judgeId y ganador por winnerId", () => {
    expect(verdictParties(participants, verdict())).toEqual({ judgeName: "Juez", winnerName: "Analista" });
  });

  it("sin ganador si winnerId es null", () => {
    expect(verdictParties(participants, verdict({ winnerId: null })).winnerName).toBeNull();
  });

  it("si judgeId no está entre los participantes, el participante con isJudge", () => {
    expect(verdictParties(participants, verdict({ judgeId: "otro" })).judgeName).toBe("Juez");
  });

  it("aviso de desactualizado solo en PENDING_REVIEW con stale", () => {
    const stale = { rounds: [], verdict: verdict({ stale: true }) };
    expect(showStaleVerdictWarning({ status: "PENDING_REVIEW", debate: stale })).toBe(true);
    expect(showStaleVerdictWarning({ status: "APPROVED", debate: stale })).toBe(false);
    expect(showStaleVerdictWarning({ status: "PENDING_REVIEW", debate: { rounds: [], verdict: verdict() } })).toBe(false);
    expect(showStaleVerdictWarning({ status: "PENDING_REVIEW", debate: { rounds: [], verdict: null } })).toBe(false);
  });
});

describe("checkpoints (AC 3.31, AC 3.40)", () => {
  const older = checkpoint("2026-09-28T10:00:00.000Z", { reason: "PROVIDER_QUOTA_EXCEEDED" });
  const newer = checkpoint("2026-09-28T12:00:00.000Z", { reason: "VOICE_NOT_CONFIGURED", debateRoundId: "r2" });

  it("lista cronológica, de más viejo a más nuevo", () => {
    expect(sortCheckpoints([newer, older])).toEqual([older, newer]);
  });

  it("el más reciente es el motivo de un FAILED", () => {
    expect(latestCheckpoint([newer, older])).toBe(newer);
    expect(latestCheckpoint([])).toBeNull();
  });

  it("ronda del checkpoint si tiene debateRoundId", () => {
    const rounds = [round("r1", 1, "OPENING"), round("r2", 2, "REBUTTAL")];
    expect(checkpointRound(rounds, newer)?.round).toBe(2);
    expect(checkpointRound(rounds, older)).toBeNull();
    expect(checkpointRound(rounds, checkpoint("2026-09-28T10:00:00.000Z", { debateRoundId: "no-existe" }))).toBeNull();
  });

  it("los 6 motivos en español, incluido VOICE_NOT_CONFIGURED", () => {
    expect(Object.keys(CHECKPOINT_REASON_LABELS).sort()).toEqual([
      "INSUFFICIENT_EVIDENCE",
      "MAX_REVISIONS_EXCEEDED",
      "PROVIDER_QUOTA_EXCEEDED",
      "USAGE_LIMIT_EXCEEDED",
      "VALIDATION_INCONSISTENCY",
      "VOICE_NOT_CONFIGURED",
    ]);
    expect(checkpointReasonLabel("VOICE_NOT_CONFIGURED")).toBe("Faltan voces de audio configuradas para el idioma del episodio");
  });

  it("un motivo desconocido no rompe: muestra el código crudo (AC 3.55)", () => {
    expect(checkpointReasonLabel("NUEVO_MOTIVO")).toBe("Motivo desconocido (NUEVO_MOTIVO)");
    expect(checkpointReasonLabel("toString")).toBe("Motivo desconocido (toString)");
  });
});

describe("cabecera (AC 3.26) e idioma del contenido (AC 3.79 b)", () => {
  it("preview desde READY_FOR_RENDER: READY_FOR_RENDER, RENDERING y COMPLETED", () => {
    expect(EPISODE_STATUSES.filter(hasPreview)).toEqual(["READY_FOR_RENDER", "RENDERING", "COMPLETED"]);
  });

  it("lang del contenido según el idioma del episodio", () => {
    expect(["ES", "EN", "PT"].map((language) => debateLanguageTag(language as "ES" | "EN" | "PT"))).toEqual(["es", "en", "pt"]);
  });
});
