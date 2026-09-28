import type { components } from "@/lib/api/schema";
import type { EpisodeStatus } from "@/lib/episode-status";

// Lógica del detalle /studio/episodes/[id] (spec 003, sección 5), sin React,
// para poder testearla sin DOM. Todo sale de getEpisodeDetail, la única
// fuente de verdad (D7).

export type EpisodeDetail = components["schemas"]["EpisodeDetailDto_Output"];
export type Participant = EpisodeDetail["participants"][number];
export type DebateRound = EpisodeDetail["debate"]["rounds"][number];
export type DebateArgument = DebateRound["arguments"][number];
export type Verdict = NonNullable<EpisodeDetail["debate"]["verdict"]>;
export type Checkpoint = EpisodeDetail["checkpoints"][number];
export type RoundType = DebateRound["type"];
export type ArgumentOrigin = DebateArgument["origin"];

/** Tipo de ronda en español (AC 3.27). */
export const ROUND_TYPE_LABELS: Readonly<Record<RoundType, string>> = {
  OPENING: "Apertura",
  REBUTTAL: "Réplica",
  CROSS_EXAMINATION: "Contrainterrogatorio",
};

/** Distintivo de origen de un argumento (AC 3.27). */
export const ARGUMENT_ORIGIN_LABELS: Readonly<Record<ArgumentOrigin, string>> = {
  AI_GENERATED: "IA",
  HUMAN_EDITED: "Editado por humano",
};

/** Nombre de un agente que no está entre los participantes (no debería pasar). */
export const UNKNOWN_AGENT_NAME = "Agente desconocido";

/** Nombre visible de un agente a partir de su `agentId` (API-1). */
export function agentName(participants: readonly Participant[], agentId: string): string {
  return participants.find((participant) => participant.agentId === agentId)?.name ?? UNKNOWN_AGENT_NAME;
}

/** Rondas en orden de `round` (AC 3.27), sin depender del orden de la API. */
export function sortRounds(rounds: readonly DebateRound[]): DebateRound[] {
  return [...rounds].sort((a, b) => a.round - b.round);
}

/** Etiqueta de una ronda: "Ronda 3 · Contrainterrogatorio". */
export function roundLabel(round: Pick<DebateRound, "round" | "type">): string {
  return `Ronda ${round.round} · ${ROUND_TYPE_LABELS[round.type]}`;
}

/** Id del elemento de un argumento en la página, destino del salto de AC 3.28. */
export function argumentElementId(argumentId: string): string {
  return `argumento-${argumentId}`;
}

/** Todos los argumentos del debate por id, para resolver `respondsToId` (AC 3.28). */
export function indexArguments(rounds: readonly DebateRound[]): ReadonlyMap<string, DebateArgument> {
  const index = new Map<string, DebateArgument>();
  for (const round of rounds) for (const argument of round.arguments) index.set(argument.id, argument);
  return index;
}

const DEFAULT_EXCERPT_LENGTH = 140;

/**
 * Extracto de un texto en una línea: colapsa los espacios y saltos, y corta
 * en el último espacio antes del límite, con "…".
 */
export function excerpt(text: string, maxLength: number = DEFAULT_EXCERPT_LENGTH): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLength) return flat;
  const cut = flat.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export interface VerdictParties {
  judgeName: string;
  /** null si `winnerId` es null: "Sin ganador" (AC 3.29). */
  winnerName: string | null;
}

/**
 * Juez y ganador del veredicto (AC 3.29). El juez es el agente de
 * `judgeId`; si no está entre los participantes, el participante con
 * `isJudge`.
 */
export function verdictParties(participants: readonly Participant[], verdict: Verdict): VerdictParties {
  const judge =
    participants.find((participant) => participant.agentId === verdict.judgeId) ??
    participants.find((participant) => participant.isJudge);
  return {
    judgeName: judge?.name ?? UNKNOWN_AGENT_NAME,
    winnerName: verdict.winnerId === null ? null : agentName(participants, verdict.winnerId),
  };
}

/**
 * Aviso de veredicto desactualizado (AC 3.81; D17): solo en PENDING_REVIEW y
 * con `debate.verdict.stale` (API-19). Fuera de ese estado ya no hay forma
 * de volver a juzgar, así que el aviso no aplica.
 */
export function showStaleVerdictWarning(detail: Pick<EpisodeDetail, "status" | "debate">): boolean {
  return detail.status === "PENDING_REVIEW" && detail.debate.verdict?.stale === true;
}

/** Checkpoints de más viejo a más nuevo (AC 3.31, "lista cronológica"). */
export function sortCheckpoints(checkpoints: readonly Checkpoint[]): Checkpoint[] {
  return [...checkpoints].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

/**
 * El checkpoint más reciente: el motivo de un FAILED (AC 3.40) y el activo
 * de REQUIRES_HUMAN_REVIEW (mismo criterio que `resume` en el backend).
 */
export function latestCheckpoint(checkpoints: readonly Checkpoint[]): Checkpoint | null {
  const sorted = sortCheckpoints(checkpoints);
  return sorted.length > 0 ? sorted[sorted.length - 1] : null;
}

/** Ronda de un checkpoint con `debateRoundId` (AC 3.31), o null si no aplica o no se encuentra. */
export function checkpointRound(rounds: readonly DebateRound[], checkpoint: Checkpoint): DebateRound | null {
  if (checkpoint.debateRoundId === null) return null;
  return rounds.find((round) => round.id === checkpoint.debateRoundId) ?? null;
}

/**
 * Estados desde los que hay preview (AC 3.26: "desde READY_FOR_RENDER"),
 * los mismos del showcase (D2). Record para que un estado nuevo en la API
 * obligue a decidir.
 */
const PREVIEW_AVAILABLE: Readonly<Record<EpisodeStatus, boolean>> = {
  CREATED: false,
  RESEARCHING: false,
  READY_FOR_DEBATE: false,
  DEBATING: false,
  JUDGING: false,
  PENDING_REVIEW: false,
  REQUIRES_HUMAN_REVIEW: false,
  APPROVED: false,
  GENERATING_AUDIO: false,
  READY_FOR_RENDER: true,
  RENDERING: true,
  COMPLETED: true,
  CANCELLED: false,
  FAILED: false,
};

export function hasPreview(status: EpisodeStatus): boolean {
  return PREVIEW_AVAILABLE[status];
}
