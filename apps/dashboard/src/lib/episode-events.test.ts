import { describe, expect, it } from "vitest";
import { AGENT_A, makeEpisodeDetail } from "@/test/episode-detail-fixture";
import {
  BUSINESS_EVENT_TYPES,
  MAX_FEED_ENTRIES,
  feedLine,
  parseBusinessEvent,
  prependFeedEntry,
  type BusinessEvent,
  type FeedEntry,
} from "./episode-events";

const { participants } = makeEpisodeDetail();

describe("tipos de evento que escucha el cliente (AC 3.32, AC 3.33)", () => {
  it("son los 6 de negocio, sin heartbeat", () => {
    expect([...BUSINESS_EVENT_TYPES].sort()).toEqual([
      "agent.thinking",
      "argument.approved",
      "episode.pending_review",
      "episode.requires_review",
      "fact_check.completed",
      "research.started",
    ]);
    expect(BUSINESS_EVENT_TYPES).not.toContain("heartbeat");
  });
});

describe("parseBusinessEvent", () => {
  it("arma el evento con el nombre y el JSON de la línea data", () => {
    expect(parseBusinessEvent("agent.thinking", JSON.stringify({ agentId: AGENT_A, round: 2 }))).toEqual({
      type: "agent.thinking",
      data: { agentId: AGENT_A, round: 2 },
    });
    expect(parseBusinessEvent("research.started", "{}")).toEqual({ type: "research.started", data: {} });
  });

  it("devuelve null con un payload que no es JSON o no tiene la forma esperada", () => {
    expect(parseBusinessEvent("agent.thinking", "no es json")).toBeNull();
    expect(parseBusinessEvent("agent.thinking", "")).toBeNull();
    expect(parseBusinessEvent("agent.thinking", JSON.stringify({ agentId: AGENT_A }))).toBeNull();
    expect(parseBusinessEvent("fact_check.completed", JSON.stringify({ status: "TRUE", errorsDetected: 0 }))).toBeNull();
    expect(parseBusinessEvent("research.started", "[]")).toBeNull();
    expect(parseBusinessEvent("research.started", "null")).toBeNull();
  });
});

describe("feedLine (AC 3.32)", () => {
  const line = (event: BusinessEvent) => feedLine(event, participants);

  it("research.started", () => {
    expect(line({ type: "research.started", data: {} })).toEqual({ text: "Empezó la investigación" });
  });

  it("agent.thinking con el nombre del agente y la ronda", () => {
    expect(line({ type: "agent.thinking", data: { agentId: AGENT_A, round: 3 } }).text).toBe(
      "Analista está preparando su argumento de la ronda 3",
    );
  });

  it("agent.thinking de un agente que no está en los participantes", () => {
    expect(line({ type: "agent.thinking", data: { agentId: "otro", round: 1 } }).text).toBe(
      "Agente desconocido está preparando su argumento de la ronda 1",
    );
  });

  it("fact_check.completed aprobado o con errores (singular y plural)", () => {
    expect(line({ type: "fact_check.completed", data: { status: "PASSED", errorsDetected: 0 } }).text).toBe(
      "Fact-check: aprobado",
    );
    expect(line({ type: "fact_check.completed", data: { status: "FAILED", errorsDetected: 1 } }).text).toBe(
      "Fact-check: 1 error detectado",
    );
    expect(line({ type: "fact_check.completed", data: { status: "FAILED", errorsDetected: 3 } }).text).toBe(
      "Fact-check: 3 errores detectados",
    );
  });

  it("argument.approved con el agente y un extracto del texto (en el idioma del debate)", () => {
    const text = "Primera línea.\n\nSegunda línea con más contenido.";
    expect(line({ type: "argument.approved", data: { agentId: AGENT_A, text } })).toEqual({
      text: "Nuevo argumento de Analista",
      quote: "Primera línea. Segunda línea con más contenido.",
    });
  });

  it("episode.pending_review y episode.requires_review con el motivo en español", () => {
    expect(line({ type: "episode.pending_review", data: {} }).text).toBe("El debate terminó y espera tu revisión");
    expect(
      line({
        type: "episode.requires_review",
        data: {
          reason: "INSUFFICIENT_EVIDENCE",
          checkpoint: {
            fromState: "RESEARCHING",
            reason: "INSUFFICIENT_EVIDENCE",
            debateRoundId: null,
            createdAt: "2026-09-28T10:00:00.000Z",
          },
        },
      }).text,
    ).toBe("El episodio requiere intervención: La investigación encontró menos de 3 fuentes válidas");
  });
});

describe("prependFeedEntry", () => {
  const entry = (id: number): FeedEntry => ({
    id,
    receivedAt: "2026-09-28T10:00:00.000Z",
    event: { type: "research.started", data: {} },
  });

  it("agrega la más nueva primero", () => {
    expect(prependFeedEntry([entry(1)], entry(2)).map((e) => e.id)).toEqual([2, 1]);
  });

  it("descarta las más viejas por encima del tope", () => {
    const full = Array.from({ length: MAX_FEED_ENTRIES }, (_, index) => entry(MAX_FEED_ENTRIES - index));
    const next = prependFeedEntry(full, entry(MAX_FEED_ENTRIES + 1));
    expect(next).toHaveLength(MAX_FEED_ENTRIES);
    expect(next[0].id).toBe(MAX_FEED_ENTRIES + 1);
    expect(next.at(-1)?.id).toBe(2);
  });
});
