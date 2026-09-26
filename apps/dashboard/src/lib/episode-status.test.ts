import { describe, expect, it } from "vitest";
import { EPISODE_STATUS_UI, STUDIO_GROUP_ORDER, type EpisodeStatus, type StudioGroup } from "./episode-status";

const statusesByGroup = (group: StudioGroup): EpisodeStatus[] =>
  (Object.keys(EPISODE_STATUS_UI) as EpisodeStatus[]).filter((status) => EPISODE_STATUS_UI[status].group === group);

describe("EPISODE_STATUS_UI (spec 003, Mapeo de estados a UI)", () => {
  it("cubre los 14 estados", () => {
    expect(Object.keys(EPISODE_STATUS_UI)).toHaveLength(14);
  });

  it("Requiere acción = PENDING_REVIEW y REQUIRES_HUMAN_REVIEW", () => {
    expect(statusesByGroup("requires-action").sort()).toEqual(["PENDING_REVIEW", "REQUIRES_HUMAN_REVIEW"]);
  });

  it("Terminados = READY_FOR_RENDER, COMPLETED, CANCELLED y FAILED", () => {
    expect(statusesByGroup("finished").sort()).toEqual(["CANCELLED", "COMPLETED", "FAILED", "READY_FOR_RENDER"]);
  });

  it("SSE solo en las fases del pipeline con eventos; polling en APPROVED, GENERATING_AUDIO y RENDERING", () => {
    const byMode = (mode: string) =>
      (Object.keys(EPISODE_STATUS_UI) as EpisodeStatus[]).filter((s) => EPISODE_STATUS_UI[s].updates === mode).sort();
    expect(byMode("sse")).toEqual(["CREATED", "DEBATING", "JUDGING", "READY_FOR_DEBATE", "RESEARCHING"]);
    expect(byMode("polling")).toEqual(["APPROVED", "GENERATING_AUDIO", "RENDERING"]);
  });

  it("solo COMPLETED, CANCELLED y FAILED son terminales", () => {
    const terminal = (Object.keys(EPISODE_STATUS_UI) as EpisodeStatus[]).filter((s) => EPISODE_STATUS_UI[s].terminal);
    expect(terminal.sort()).toEqual(["CANCELLED", "COMPLETED", "FAILED"]);
  });

  it("etiquetas en español según la tabla", () => {
    expect(EPISODE_STATUS_UI.PENDING_REVIEW.label).toBe("Esperando revisión");
    expect(EPISODE_STATUS_UI.REQUIRES_HUMAN_REVIEW.label).toBe("Requiere intervención");
    expect(EPISODE_STATUS_UI.READY_FOR_RENDER.label).toBe("Listo");
    expect(EPISODE_STATUS_UI.FAILED.category).toBe("error");
  });

  it("los grupos se ordenan con Requiere acción primero (US 3.1)", () => {
    expect(STUDIO_GROUP_ORDER[0]).toBe("requires-action");
  });
});
