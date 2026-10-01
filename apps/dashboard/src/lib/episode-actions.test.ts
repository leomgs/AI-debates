import { describe, expect, it } from "vitest";
import { makeEpisodeDetail } from "@/test/episode-detail-fixture";
import { ApiError } from "./api/errors";
import {
  APPROVE_STALE_VERDICT_WARNING,
  ARGUMENT_NOT_FOUND_MESSAGE,
  EPISODE_NOT_FOUND_MESSAGE,
  LLM_BUDGET_ERROR_MESSAGE,
  PROVIDER_QUOTA_ERROR_MESSAGE,
  STATE_CHANGED_MESSAGE,
  actionErrorView,
  canRunAction,
  editDraftState,
  isArgumentAction,
  lastLlmCallWarning,
  leavesStateOnSuccess,
  llmBudget,
  llmBudgetExhaustedExplanation,
  llmBudgetSummary,
  refetchesAfterError,
  reviewControls,
  showsScreenNotice,
  validationErrorText,
  type CurationAction,
} from "./episode-actions";
import { EPISODE_STATUSES } from "./episode-status";

function apiError(status: number, code: string, message = "mensaje del backend") {
  return new ApiError({ status, code, message });
}

const ALL_ACTIONS: CurationAction[] = ["approve", "edit", "regenerate", "regenerate-verdict", "reject", "resume"];

function actionsIn(status: (typeof EPISODE_STATUSES)[number]): CurationAction[] {
  return ALL_ACTIONS.filter((action) => canRunAction(status, action)).sort();
}

describe("canRunAction (AC 3.42; api-contract.md §5)", () => {
  it("PENDING_REVIEW: aprobar, editar, regenerar, volver a juzgar y rechazar", () => {
    expect(actionsIn("PENDING_REVIEW")).toEqual(["approve", "edit", "regenerate", "regenerate-verdict", "reject"]);
  });

  it("REQUIRES_HUMAN_REVIEW: solo reanudar y rechazar", () => {
    expect(actionsIn("REQUIRES_HUMAN_REVIEW")).toEqual(["reject", "resume"]);
  });

  it("en cualquier otro estado no hay controles de curaduría", () => {
    for (const status of EPISODE_STATUSES) {
      if (status === "PENDING_REVIEW" || status === "REQUIRES_HUMAN_REVIEW") continue;
      expect(actionsIn(status), status).toEqual([]);
    }
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
  it("409 INVALID_STATE_TRANSITION en cualquier acción: refetch y aviso de pantalla (AC 3.48, AC 3.85)", () => {
    for (const action of ALL_ACTIONS) {
      const view = actionErrorView(action, apiError(409, "INVALID_STATE_TRANSITION"));
      expect(view, action).toEqual({ kind: "state-changed", message: STATE_CHANGED_MESSAGE, refetch: true });
      expect(refetchesAfterError(view)).toBe(true);
      expect(showsScreenNotice(view)).toBe(true);
    }
  });

  it("regenerate y regenerate-verdict: mensajes específicos de presupuesto y proveedor (AC 3.50, AC 3.85)", () => {
    for (const action of ["regenerate", "regenerate-verdict"] as const) {
      expect(actionErrorView(action, apiError(409, "USAGE_LIMIT_EXCEEDED")).message).toBe(LLM_BUDGET_ERROR_MESSAGE);
      expect(actionErrorView(action, apiError(503, "PROVIDER_QUOTA_EXCEEDED"))).toEqual({
        kind: "error",
        message: PROVIDER_QUOTA_ERROR_MESSAGE,
        refetch: false,
      });
      expect(refetchesAfterError(actionErrorView(action, apiError(503, "PROVIDER_QUOTA_EXCEEDED")))).toBe(false);
    }
  });

  it("presupuesto LLM agotado: refresca el detalle pero el mensaje sigue junto al control (AC 3.46, AC 3.83)", () => {
    for (const action of ["regenerate", "regenerate-verdict"] as const) {
      const view = actionErrorView(action, apiError(409, "USAGE_LIMIT_EXCEEDED"));
      expect(view, action).toEqual({ kind: "error", message: LLM_BUDGET_ERROR_MESSAGE, refetch: true });
      expect(refetchesAfterError(view)).toBe(true);
      expect(showsScreenNotice(view)).toBe(false);
    }
  });

  it("404 sobre un argumento refresca el detalle y va al aviso de pantalla (AC 3.50, API-14)", () => {
    const view = actionErrorView("regenerate", apiError(404, "NOT_FOUND"));
    expect(view).toEqual({ kind: "not-found", message: ARGUMENT_NOT_FOUND_MESSAGE, refetch: true });
    expect(refetchesAfterError(view)).toBe(true);
    expect(showsScreenNotice(view)).toBe(true);
    expect(actionErrorView("edit", apiError(404, "NOT_FOUND")).message).toBe(ARGUMENT_NOT_FOUND_MESSAGE);
  });

  it("404 en una acción del episodio: el episodio ya no existe", () => {
    expect(actionErrorView("approve", apiError(404, "NOT_FOUND"))).toEqual({
      kind: "not-found",
      message: EPISODE_NOT_FOUND_MESSAGE,
      refetch: true,
    });
  });

  it("un 404 sin el envelope (del rewrite) es un error genérico, como en isNotFoundError", () => {
    const view = actionErrorView("approve", apiError(404, "UNKNOWN_ERROR", "HTTP 404"));
    expect(view).toEqual({ kind: "error", message: "No se pudo aprobar el episodio. HTTP 404", refetch: false });
  });

  it("500 INTERNAL_ERROR del juez: error genérico con el mensaje del backend (AC 3.85)", () => {
    const view = actionErrorView("regenerate-verdict", apiError(500, "INTERNAL_ERROR", "El juez falló"));
    expect(view).toEqual({ kind: "error", message: "No se pudo volver a juzgar. El juez falló", refetch: false });
    expect(refetchesAfterError(view)).toBe(false);
    expect(showsScreenNotice(view)).toBe(false);
  });

  it("400 VALIDATION_ERROR: mensaje del backend para el formulario (AC 3.54)", () => {
    expect(actionErrorView("resume", apiError(400, "VALIDATION_ERROR", "manualSources.0.url: Invalid URL"))).toEqual({
      kind: "validation",
      message: "manualSources.0.url: Invalid URL",
      refetch: false,
    });
    expect(
      actionErrorView("resume", apiError(400, "VALIDATION_ERROR", ": Debe incluir al menos maxLlmCalls o maxSearchQueries")),
    ).toEqual({ kind: "validation", message: "Debe incluir al menos maxLlmCalls o maxSearchQueries", refetch: false });
  });

  it("presupuesto agotado fuera de las acciones con LLM: error genérico, sin refetch", () => {
    const view = actionErrorView("approve", apiError(409, "USAGE_LIMIT_EXCEEDED", "x"));
    expect(view.message).toBe("No se pudo aprobar el episodio. x");
    expect(refetchesAfterError(view)).toBe(false);
  });

  it("sin respuesta del servidor: error genérico sin JSON crudo", () => {
    const view = actionErrorView("reject", new TypeError("Failed to fetch"));
    expect(view.kind).toBe("error");
    expect(view.refetch).toBe(false);
    expect(view.message).toMatch(/^No se pudo rechazar el episodio\. No hubo respuesta del servidor/);
  });

  it("validationErrorText saca el ': ' de un issue sin campo", () => {
    expect(validationErrorText(": algo")).toBe("algo");
    expect(validationErrorText("campo: algo")).toBe("campo: algo");
  });
});

describe("leavesStateOnSuccess (AC 3.77)", () => {
  it("aprobar, rechazar y reanudar sacan al episodio del estado; el resto se queda en PENDING_REVIEW", () => {
    expect(ALL_ACTIONS.filter(leavesStateOnSuccess).sort()).toEqual(["approve", "reject", "resume"]);
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

describe("reviewControls (AC 3.42, AC 3.46, AC 3.81-3.84)", () => {
  const verdict = {
    id: "00000000-0000-4000-8000-0000000000f1",
    judgeId: "00000000-0000-4000-8000-00000000000c",
    content: "Gana el analista.",
    winnerId: null,
    createdAt: "2026-09-28T11:00:00.000Z",
    stale: false,
  };

  it("solo en PENDING_REVIEW", () => {
    for (const status of EPISODE_STATUSES) {
      const controls = reviewControls(makeEpisodeDetail({ status }));
      expect(controls === null).toBe(status !== "PENDING_REVIEW");
    }
  });

  it("los decide la tabla de acciones: existen justo donde se puede aprobar (AC 3.42)", () => {
    for (const status of EPISODE_STATUSES) {
      expect(reviewControls(makeEpisodeDetail({ status })) !== null, status).toBe(canRunAction(status, "approve"));
    }
  });

  it("Regenerar y Volver a juzgar habilitados mientras quede presupuesto LLM", () => {
    const controls = reviewControls(
      makeEpisodeDetail({
        status: "PENDING_REVIEW",
        usage: { llmCalls: 24, searchRequests: 0, ttsRequests: 0, executionTime: 0 },
        limits: { maxLlmCalls: 25, maxSearchQueries: 5, maxTtsSegments: 40 },
      }),
    );
    expect(controls?.llmActionsEnabled).toBe(true);
    expect(controls?.budget).toEqual({ used: 24, limit: 25, exhausted: false });
  });

  it("deshabilitados con el presupuesto LLM agotado", () => {
    const controls = reviewControls(
      makeEpisodeDetail({
        status: "PENDING_REVIEW",
        usage: { llmCalls: 25, searchRequests: 0, ttsRequests: 0, executionTime: 0 },
        limits: { maxLlmCalls: 25, maxSearchQueries: 5, maxTtsSegments: 40 },
      }),
    );
    expect(controls?.llmActionsEnabled).toBe(false);
  });

  it("veredicto desactualizado solo con stale en true", () => {
    const fresh = reviewControls(makeEpisodeDetail({ status: "PENDING_REVIEW", debate: { rounds: [], verdict } }));
    const stale = reviewControls(
      makeEpisodeDetail({ status: "PENDING_REVIEW", debate: { rounds: [], verdict: { ...verdict, stale: true } } }),
    );
    const none = reviewControls(makeEpisodeDetail({ status: "PENDING_REVIEW", debate: { rounds: [], verdict: null } }));
    expect(fresh?.staleVerdict).toBe(false);
    expect(stale?.staleVerdict).toBe(true);
    expect(none?.staleVerdict).toBe(false);
    expect(APPROVE_STALE_VERDICT_WARNING).toBe("El veredicto es anterior a tus cambios y es el que se va a publicar.");
  });

  it("avisa cuando se va a gastar la última llamada LLM", () => {
    expect(lastLlmCallWarning({ used: 24, limit: 25, exhausted: false })).not.toBeNull();
    expect(lastLlmCallWarning({ used: 20, limit: 25, exhausted: false })).toBeNull();
    expect(lastLlmCallWarning({ used: 25, limit: 25, exhausted: true })).toBeNull();
  });
});
