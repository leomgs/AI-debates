import { describe, expect, it } from "vitest";
import { makeEpisodeDetail } from "@/test/episode-detail-fixture";
import { ApiError } from "./api/errors";
import {
  ARGUMENT_NOT_FOUND_MESSAGE,
  EPISODE_NOT_FOUND_MESSAGE,
  LLM_BUDGET_ERROR_MESSAGE,
  PROVIDER_QUOTA_ERROR_MESSAGE,
  STATE_CHANGED_MESSAGE,
  actionErrorView,
  availableActions,
  canRunAction,
  editDraftState,
  isArgumentAction,
  llmBudget,
  llmBudgetExhaustedExplanation,
  llmBudgetSummary,
  refetchesAfterError,
  validationErrorText,
  type CurationAction,
} from "./episode-actions";
import { EPISODE_STATUSES } from "./episode-status";

function apiError(status: number, code: string, message = "mensaje del backend") {
  return new ApiError({ status, code, message });
}

describe("availableActions (AC 3.42; api-contract.md §5)", () => {
  it("PENDING_REVIEW: aprobar, editar, regenerar, volver a juzgar y rechazar", () => {
    expect([...availableActions("PENDING_REVIEW")].sort()).toEqual(
      ["approve", "edit", "regenerate", "regenerate-verdict", "reject"].sort(),
    );
  });

  it("REQUIRES_HUMAN_REVIEW: solo reanudar y rechazar", () => {
    expect([...availableActions("REQUIRES_HUMAN_REVIEW")].sort()).toEqual(["reject", "resume"]);
  });

  it("en cualquier otro estado no hay controles de curaduría", () => {
    for (const status of EPISODE_STATUSES) {
      if (status === "PENDING_REVIEW" || status === "REQUIRES_HUMAN_REVIEW") continue;
      expect(availableActions(status), status).toEqual([]);
    }
  });

  it("reject vale en los dos estados de revisión; resume solo en REQUIRES_HUMAN_REVIEW", () => {
    expect(canRunAction("PENDING_REVIEW", "reject")).toBe(true);
    expect(canRunAction("REQUIRES_HUMAN_REVIEW", "reject")).toBe(true);
    expect(canRunAction("PENDING_REVIEW", "resume")).toBe(false);
    expect(canRunAction("REQUIRES_HUMAN_REVIEW", "approve")).toBe(false);
    expect(canRunAction("REQUIRES_HUMAN_REVIEW", "regenerate-verdict")).toBe(false);
    expect(canRunAction("APPROVED", "reject")).toBe(false);
  });
});

describe("llmBudget (AC 3.46, AC 3.83)", () => {
  it("habilitado mientras queden llamadas", () => {
    const detail = makeEpisodeDetail({ usage: { llmCalls: 24, searchRequests: 0, ttsRequests: 0, executionTime: 0 } });
    expect(llmBudget({ ...detail, limits: { ...detail.limits, maxLlmCalls: 25 } })).toEqual({
      used: 24,
      limit: 25,
      exhausted: false,
    });
  });

  it("agotado con usage.llmCalls >= limits.maxLlmCalls (incluso si lo pasó)", () => {
    const base = makeEpisodeDetail();
    const at = { ...base, usage: { ...base.usage!, llmCalls: 25 }, limits: { ...base.limits, maxLlmCalls: 25 } };
    const over = { ...base, usage: { ...base.usage!, llmCalls: 38 }, limits: { ...base.limits, maxLlmCalls: 25 } };
    expect(llmBudget(at).exhausted).toBe(true);
    expect(llmBudget(over).exhausted).toBe(true);
  });

  it("usage null cuenta como 0 usadas", () => {
    expect(llmBudget(makeEpisodeDetail({ usage: null }))).toMatchObject({ used: 0, exhausted: false });
  });

  it("un límite de 0 está agotado aunque no haya consumo", () => {
    const base = makeEpisodeDetail({ usage: null });
    expect(llmBudget({ ...base, limits: { ...base.limits, maxLlmCalls: 0 } }).exhausted).toBe(true);
  });

  it("textos con usadas y límite", () => {
    const budget = { used: 25, limit: 25, exhausted: true };
    expect(llmBudgetSummary(budget)).toBe("Llamadas LLM usadas: 25 de 25.");
    expect(llmBudgetExhaustedExplanation(budget)).toContain("(25 de 25)");
    expect(llmBudgetExhaustedExplanation(budget)).toContain("no se puede subir el límite");
  });
});

describe("editDraftState (AC 3.44)", () => {
  it("sin cambios no se guarda ni pide confirmación al cancelar", () => {
    expect(editDraftState("Texto", "Texto")).toEqual({ value: "Texto", dirty: false, canSave: false });
  });

  it("vacío o solo espacios no se guarda", () => {
    expect(editDraftState("Texto", "").canSave).toBe(false);
    expect(editDraftState("Texto", "   \n").canSave).toBe(false);
    expect(editDraftState("Texto", "   \n").dirty).toBe(true);
  });

  it("igual al original salvo espacios de los bordes no se guarda", () => {
    expect(editDraftState("Texto", "  Texto\n").canSave).toBe(false);
  });

  it("con un cambio real se guarda recortado", () => {
    expect(editDraftState("Texto", " Texto corregido ")).toEqual({
      value: "Texto corregido",
      dirty: true,
      canSave: true,
    });
  });

  it("respeta los saltos de línea internos", () => {
    expect(editDraftState("a", "a\n\nb").value).toBe("a\n\nb");
  });
});

describe("actionErrorView", () => {
  const ALL: CurationAction[] = ["approve", "edit", "regenerate", "regenerate-verdict", "reject", "resume"];

  it("409 INVALID_STATE_TRANSITION en cualquier acción: aviso y refetch (AC 3.48, AC 3.85)", () => {
    for (const action of ALL) {
      const view = actionErrorView(action, apiError(409, "INVALID_STATE_TRANSITION"));
      expect(view, action).toEqual({ kind: "state-changed", message: STATE_CHANGED_MESSAGE });
      expect(refetchesAfterError(view)).toBe(true);
    }
  });

  it("regenerate y regenerate-verdict: mensajes específicos de presupuesto y proveedor (AC 3.50, AC 3.85)", () => {
    for (const action of ["regenerate", "regenerate-verdict"] as const) {
      expect(actionErrorView(action, apiError(409, "USAGE_LIMIT_EXCEEDED"))).toEqual({
        kind: "error",
        message: LLM_BUDGET_ERROR_MESSAGE,
      });
      expect(actionErrorView(action, apiError(503, "PROVIDER_QUOTA_EXCEEDED"))).toEqual({
        kind: "error",
        message: PROVIDER_QUOTA_ERROR_MESSAGE,
      });
      expect(refetchesAfterError(actionErrorView(action, apiError(503, "PROVIDER_QUOTA_EXCEEDED")))).toBe(false);
    }
  });

  it("404 sobre un argumento refresca el detalle (AC 3.50, API-14)", () => {
    const view = actionErrorView("regenerate", apiError(404, "NOT_FOUND"));
    expect(view).toEqual({ kind: "not-found", message: ARGUMENT_NOT_FOUND_MESSAGE });
    expect(refetchesAfterError(view)).toBe(true);
    expect(actionErrorView("edit", apiError(404, "NOT_FOUND")).message).toBe(ARGUMENT_NOT_FOUND_MESSAGE);
  });

  it("404 en una acción del episodio: el episodio ya no existe", () => {
    expect(actionErrorView("approve", apiError(404, "NOT_FOUND"))).toEqual({
      kind: "not-found",
      message: EPISODE_NOT_FOUND_MESSAGE,
    });
  });

  it("500 INTERNAL_ERROR del juez: error genérico con el mensaje del backend (AC 3.85)", () => {
    const view = actionErrorView("regenerate-verdict", apiError(500, "INTERNAL_ERROR", "El juez falló"));
    expect(view).toEqual({ kind: "error", message: "No se pudo volver a juzgar. El juez falló" });
    expect(refetchesAfterError(view)).toBe(false);
  });

  it("400 VALIDATION_ERROR: mensaje del backend para el formulario (AC 3.54)", () => {
    expect(actionErrorView("resume", apiError(400, "VALIDATION_ERROR", "manualSources.0.url: Invalid URL"))).toEqual({
      kind: "validation",
      message: "manualSources.0.url: Invalid URL",
    });
    expect(
      actionErrorView("resume", apiError(400, "VALIDATION_ERROR", ": Debe incluir al menos maxLlmCalls o maxSearchQueries")),
    ).toEqual({ kind: "validation", message: "Debe incluir al menos maxLlmCalls o maxSearchQueries" });
  });

  it("presupuesto agotado fuera de las acciones con LLM: error genérico", () => {
    expect(actionErrorView("approve", apiError(409, "USAGE_LIMIT_EXCEEDED", "x")).message).toBe(
      "No se pudo aprobar el episodio. x",
    );
  });

  it("sin respuesta del servidor: error genérico sin JSON crudo", () => {
    const view = actionErrorView("reject", new TypeError("Failed to fetch"));
    expect(view.kind).toBe("error");
    expect(view.message).toMatch(/^No se pudo rechazar el episodio\. No hubo respuesta del servidor/);
  });

  it("validationErrorText saca el ': ' de un issue sin campo", () => {
    expect(validationErrorText(": algo")).toBe("algo");
    expect(validationErrorText("campo: algo")).toBe("campo: algo");
  });
});

describe("isArgumentAction", () => {
  it("solo edit y regenerate sobre ese argumento", () => {
    expect(isArgumentAction({ action: "regenerate", argumentId: "a" }, "a")).toBe(true);
    expect(isArgumentAction({ action: "edit", argumentId: "a", content: "x" }, "a")).toBe(true);
    expect(isArgumentAction({ action: "regenerate", argumentId: "a" }, "b")).toBe(false);
    expect(isArgumentAction({ action: "approve" }, "a")).toBe(false);
    expect(isArgumentAction(undefined, "a")).toBe(false);
  });
});
