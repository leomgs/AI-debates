import { describe, expect, it } from "vitest";
import { makeEpisodeDetail } from "@/test/episode-detail-fixture";
import { ApiError } from "./api/errors";
import { EPISODE_STATUSES, type EpisodeStatus } from "./episode-status";
import {
  detailRefetchInterval,
  liveUpdateMode,
  reconnectDelayMs,
  shouldReconnectAfterRefetch,
  type LiveUpdateMode,
} from "./live-updates";
import { POLLING_INTERVALS_MS } from "./polling";

const SSE_STATUSES: EpisodeStatus[] = ["CREATED", "RESEARCHING", "READY_FOR_DEBATE", "DEBATING", "JUDGING"];
const POLLING_STATUSES: EpisodeStatus[] = ["APPROVED", "GENERATING_AUDIO", "RENDERING"];
const HALTED_STATUSES: EpisodeStatus[] = [
  "PENDING_REVIEW",
  "REQUIRES_HUMAN_REVIEW",
  "READY_FOR_RENDER",
  "COMPLETED",
  "CANCELLED",
  "FAILED",
];

describe("liveUpdateMode (Mapeo de estados a UI; AC 3.32, 3.35, 3.36, 3.39)", () => {
  it("cubre los 14 estados en alguno de los tres grupos", () => {
    expect([...SSE_STATUSES, ...POLLING_STATUSES, ...HALTED_STATUSES].sort()).toEqual([...EPISODE_STATUSES].sort());
  });

  it.each(SSE_STATUSES)("%s con pipeline activo: SSE", (status) => {
    expect(liveUpdateMode(status, true)).toBe<LiveUpdateMode>("sse");
  });

  it.each(POLLING_STATUSES)("%s con pipeline activo: polling", (status) => {
    expect(liveUpdateMode(status, true)).toBe<LiveUpdateMode>("polling");
  });

  it.each([...SSE_STATUSES, ...POLLING_STATUSES])("%s sin pipeline activo: trabado, sin SSE ni polling", (status) => {
    expect(liveUpdateMode(status, false)).toBe<LiveUpdateMode>("stuck");
  });

  it.each(HALTED_STATUSES)("%s: sin actualización, tenga o no pipeline activo", (status) => {
    expect(liveUpdateMode(status, true)).toBe<LiveUpdateMode>("none");
    expect(liveUpdateMode(status, false)).toBe<LiveUpdateMode>("none");
  });
});

describe("detailRefetchInterval (AC 3.35, AC 3.86)", () => {
  it("10 s desde las constantes en APPROVED, GENERATING_AUDIO y RENDERING con pipeline activo", () => {
    for (const status of POLLING_STATUSES) {
      expect(detailRefetchInterval(makeEpisodeDetail({ status, pipelineActive: true }))).toBe(
        POLLING_INTERVALS_MS.episodeDetail,
      );
    }
  });

  it("sin polling en SSE, en estados frenados, trabado o sin datos", () => {
    expect(detailRefetchInterval(undefined)).toBe(false);
    expect(detailRefetchInterval(makeEpisodeDetail({ status: "DEBATING", pipelineActive: true }))).toBe(false);
    expect(detailRefetchInterval(makeEpisodeDetail({ status: "GENERATING_AUDIO", pipelineActive: false }))).toBe(false);
    expect(detailRefetchInterval(makeEpisodeDetail({ status: "READY_FOR_RENDER", pipelineActive: false }))).toBe(false);
  });
});

describe("shouldReconnectAfterRefetch (AC 3.38)", () => {
  it("reconecta si el estado sigue siendo SSE con pipeline activo", () => {
    expect(shouldReconnectAfterRefetch({ detail: makeEpisodeDetail({ status: "JUDGING" }), error: null })).toBe(true);
  });

  it("no reconecta si el detalle pasó a un estado frenado o terminal (AC 3.36)", () => {
    const detail = makeEpisodeDetail({ status: "PENDING_REVIEW", pipelineActive: false });
    expect(shouldReconnectAfterRefetch({ detail, error: null })).toBe(false);
  });

  it("no reconecta si el pipeline dejó de estar activo (trabado, AC 3.39)", () => {
    const detail = makeEpisodeDetail({ status: "DEBATING", pipelineActive: false });
    expect(shouldReconnectAfterRefetch({ detail, error: null })).toBe(false);
  });

  it("no reconecta si pasó a una fase con polling", () => {
    const detail = makeEpisodeDetail({ status: "GENERATING_AUDIO", pipelineActive: true });
    expect(shouldReconnectAfterRefetch({ detail, error: null })).toBe(false);
  });

  it("no reconecta con un 401: lo resuelve el manejo global (AC 3.7)", () => {
    const error = new ApiError({ status: 401, code: "UNAUTHORIZED", message: "Sesión vencida" });
    expect(shouldReconnectAfterRefetch({ detail: makeEpisodeDetail(), error })).toBe(false);
  });

  it("no reconecta con un 404", () => {
    const error = new ApiError({ status: 404, code: "NOT_FOUND", message: "No existe" });
    expect(shouldReconnectAfterRefetch({ detail: makeEpisodeDetail(), error })).toBe(false);
  });

  it("con otro error decide con el último detalle conocido", () => {
    const error = new TypeError("Failed to fetch");
    expect(shouldReconnectAfterRefetch({ detail: makeEpisodeDetail(), error })).toBe(true);
    expect(shouldReconnectAfterRefetch({ detail: undefined, error })).toBe(false);
  });
});

describe("reconnectDelayMs", () => {
  it("crece de 1 s al doble hasta un tope de 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(reconnectDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });
});
