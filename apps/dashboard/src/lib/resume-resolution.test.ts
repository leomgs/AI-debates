import { describe, expect, it } from "vitest";
import { AGENT_A, AGENT_B, JUDGE, makeEpisodeDetail } from "@/test/episode-detail-fixture";
import { canRunAction } from "./episode-actions";
import type { DebateRound, EpisodeDetail } from "./episode-detail";
import { EPISODE_STATUSES } from "./episode-status";
import { liveUpdateMode } from "./live-updates";
import {
  EMPTY_RESUME_BODY,
  MAX_LIMIT_VALUE,
  activeResolution,
  REPEAT_REASON_WARNING,
  agentsToReviewForVoices,
  agentsWithoutOfficialArguments,
  exhaustedMetrics,
  initialUsageLimitValues,
  isValidSourceUrl,
  repeatReasonWarning,
  resolutionKind,
  usageLimitMode,
  validateManualSources,
  validateUsageLimitForm,
} from "./resume-resolution";

function withUsage(
  usage: Partial<NonNullable<EpisodeDetail["usage"]>>,
  limits: Partial<EpisodeDetail["limits"]> = {},
): EpisodeDetail {
  const base = makeEpisodeDetail({ status: "REQUIRES_HUMAN_REVIEW", pipelineActive: false });
  return {
    ...base,
    usage: { llmCalls: 0, searchRequests: 0, ttsRequests: 0, executionTime: 0, ...usage },
    limits: { maxLlmCalls: 25, maxSearchQueries: 5, maxTtsSegments: 40, ...limits },
  };
}

describe("resolutionKind (AC 3.51, AC 3.55)", () => {
  it("un panel por cada uno de los 6 motivos", () => {
    expect(resolutionKind("USAGE_LIMIT_EXCEEDED")).toBe("usage-limit");
    expect(resolutionKind("INSUFFICIENT_EVIDENCE")).toBe("insufficient-evidence");
    expect(resolutionKind("MAX_REVISIONS_EXCEEDED")).toBe("empty");
    expect(resolutionKind("PROVIDER_QUOTA_EXCEEDED")).toBe("empty");
    expect(resolutionKind("VOICE_NOT_CONFIGURED")).toBe("empty");
    expect(resolutionKind("VALIDATION_INCONSISTENCY")).toBe("blocked");
  });

  it("un motivo desconocido va al panel genérico, sin romper", () => {
    expect(resolutionKind("ALGO_NUEVO")).toBe("unknown");
    expect(resolutionKind("toString")).toBe("unknown");
    expect(resolutionKind("")).toBe("unknown");
  });

  it("el body vacío es exactamente {}", () => {
    expect(EMPTY_RESUME_BODY).toEqual({});
    expect(JSON.stringify(EMPTY_RESUME_BODY)).toBe("{}");
  });
});

describe("repeatReasonWarning (AC 3.52)", () => {
  it("el aviso base para los motivos sin agregado", () => {
    expect(repeatReasonWarning("MAX_REVISIONS_EXCEEDED")).toEqual([REPEAT_REASON_WARNING]);
    expect(repeatReasonWarning("USAGE_LIMIT_EXCEEDED")).toEqual([REPEAT_REASON_WARNING]);
    expect(repeatReasonWarning("INSUFFICIENT_EVIDENCE")).toEqual([REPEAT_REASON_WARNING]);
    expect(REPEAT_REASON_WARNING).toContain("pasa a Falló y no se puede recuperar");
  });

  it("PROVIDER_QUOTA_EXCEEDED agrega que reanudar antes de tiempo gasta el reintento", () => {
    const lines = repeatReasonWarning("PROVIDER_QUOTA_EXCEEDED");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("antes de que el proveedor se recupere");
  });

  it("VOICE_NOT_CONFIGURED agrega que reanudar sin corregir las voces lo gasta igual", () => {
    const lines = repeatReasonWarning("VOICE_NOT_CONFIGURED");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("sin haber corregido las voces");
  });
});

describe("USAGE_LIMIT_EXCEEDED (AC 3.51)", () => {
  it("detecta la métrica que llegó al límite", () => {
    const detail = withUsage({ llmCalls: 25, searchRequests: 2 });
    expect(exhaustedMetrics(detail.usage, detail.limits)).toEqual([{ key: "llmCalls", used: 25, limit: 25 }]);
    expect(exhaustedMetrics(null, detail.limits)).toEqual([]);
  });

  it("formulario si se agotaron llamadas o búsquedas", () => {
    expect(usageLimitMode(withUsage({ llmCalls: 25 }), { fromState: "DEBATING" })).toBe("form");
    expect(usageLimitMode(withUsage({ searchRequests: 5 }), { fromState: "RESEARCHING" })).toBe("form");
  });

  it("solo Rechazar si la métrica agotada es ttsRequests (sin API-16)", () => {
    expect(usageLimitMode(withUsage({ ttsRequests: 40 }), { fromState: "GENERATING_AUDIO" })).toBe("tts-reject-only");
    expect(usageLimitMode(withUsage({ ttsRequests: 40 }), { fromState: "APPROVED" })).toBe("tts-reject-only");
    // En la fase de audio solo se consume TTS, aunque las otras también estén al tope.
    expect(usageLimitMode(withUsage({ ttsRequests: 40, llmCalls: 25 }), { fromState: "GENERATING_AUDIO" })).toBe(
      "tts-reject-only",
    );
  });

  it("precarga los límites actuales", () => {
    expect(initialUsageLimitValues({ maxLlmCalls: 25, maxSearchQueries: 5, maxTtsSegments: 40 })).toEqual({
      maxLlmCalls: "25",
      maxSearchQueries: "5",
    });
  });

  it("precargado sin tocar no se puede enviar: el límite agotado tiene que subir", () => {
    const detail = withUsage({ llmCalls: 25, searchRequests: 2 });
    const result = validateUsageLimitForm(initialUsageLimitValues(detail.limits), detail);
    expect(result.body).toBeNull();
    expect(result.fieldErrors.maxLlmCalls).toBe("Tiene que ser mayor que el consumo actual (25).");
    expect(result.fieldErrors.maxSearchQueries).toBeUndefined();
  });

  it("manda solo el límite que cambió", () => {
    const detail = withUsage({ llmCalls: 25, searchRequests: 2 });
    const result = validateUsageLimitForm({ maxLlmCalls: "40", maxSearchQueries: "5" }, detail);
    expect(result).toEqual({ body: { maxLlmCalls: 40 }, fieldErrors: {}, formError: null });
  });

  it("manda los dos si cambian los dos", () => {
    const detail = withUsage({ llmCalls: 25, searchRequests: 5 });
    expect(validateUsageLimitForm({ maxLlmCalls: " 30 ", maxSearchQueries: "8" }, detail).body).toEqual({
      maxLlmCalls: 30,
      maxSearchQueries: 8,
    });
  });

  it("el límite nuevo tiene que ser mayor que el consumo, no solo que el límite", () => {
    // Consumo por encima del límite (la carrera que corrigió el backend).
    const detail = withUsage({ llmCalls: 38 });
    expect(validateUsageLimitForm({ maxLlmCalls: "38", maxSearchQueries: "5" }, detail).fieldErrors.maxLlmCalls).toBe(
      "Tiene que ser mayor que el consumo actual (38).",
    );
    expect(validateUsageLimitForm({ maxLlmCalls: "39", maxSearchQueries: "5" }, detail).body).toEqual({
      maxLlmCalls: 39,
    });
  });

  it("rechaza no enteros, negativos, cero y números enormes", () => {
    const detail = withUsage({ llmCalls: 25 });
    for (const value of ["abc", "1.5", "-3", "1e3", "0"]) {
      expect(validateUsageLimitForm({ maxLlmCalls: value, maxSearchQueries: "5" }, detail).fieldErrors.maxLlmCalls, value).toBe(
        "Tiene que ser un número entero positivo.",
      );
    }
    expect(
      validateUsageLimitForm({ maxLlmCalls: "99999999999999999999", maxSearchQueries: "5" }, detail).fieldErrors.maxLlmCalls,
    ).toBe("El número es demasiado grande.");
  });

  it("tope en el máximo de int32: la columna es Int de Prisma y fuera de rango la API responde 500", () => {
    const detail = withUsage({ llmCalls: 25 });
    expect(MAX_LIMIT_VALUE).toBe(2_147_483_647);
    const atMax = validateUsageLimitForm({ maxLlmCalls: "2147483647", maxSearchQueries: "5" }, detail);
    expect(atMax.fieldErrors).toEqual({});
    expect(atMax.body).toEqual({ maxLlmCalls: 2_147_483_647 });
    for (const value of ["2147483648", "9007199254740991"]) {
      expect(validateUsageLimitForm({ maxLlmCalls: value, maxSearchQueries: "5" }, detail).fieldErrors.maxLlmCalls, value).toBe(
        "El número es demasiado grande.",
      );
    }
    expect(
      validateUsageLimitForm({ maxLlmCalls: "30", maxSearchQueries: "2147483648" }, detail).fieldErrors.maxSearchQueries,
    ).toBe("El número es demasiado grande.");
  });

  it("vacío en la métrica agotada es un error; en la otra, no se manda", () => {
    const detail = withUsage({ llmCalls: 25 });
    expect(validateUsageLimitForm({ maxLlmCalls: "", maxSearchQueries: "" }, detail).fieldErrors).toEqual({
      maxLlmCalls: "Este límite se agotó: subilo para poder reanudar.",
    });
    expect(validateUsageLimitForm({ maxLlmCalls: "30", maxSearchQueries: "" }, detail).body).toEqual({ maxLlmCalls: 30 });
  });

  it("al menos un límite: sin cambios no se manda {} (el .refine del backend)", () => {
    // Caso raro: ninguna métrica agotada según el detalle.
    const detail = withUsage({ llmCalls: 1 });
    const result = validateUsageLimitForm(initialUsageLimitValues(detail.limits), detail);
    expect(result.body).toBeNull();
    expect(result.formError).toBe("Subí al menos un límite para poder reanudar.");
  });

  it("nunca manda maxTtsSegments (API-16 no existe)", () => {
    const detail = withUsage({ llmCalls: 25 });
    const body = validateUsageLimitForm({ maxLlmCalls: "30", maxSearchQueries: "9" }, detail).body;
    expect(Object.keys(body ?? {}).sort()).toEqual(["maxLlmCalls", "maxSearchQueries"]);
  });
});

describe("INSUFFICIENT_EVIDENCE (AC 3.51)", () => {
  it("URL http(s) absoluta", () => {
    expect(isValidSourceUrl("https://example.com/nota")).toBe(true);
    expect(isValidSourceUrl("http://example.com")).toBe(true);
    expect(isValidSourceUrl("example.com")).toBe(false);
    expect(isValidSourceUrl("ftp://example.com")).toBe(false);
    expect(isValidSourceUrl("javascript:alert(1)")).toBe(false);
    expect(isValidSourceUrl("")).toBe(false);
  });

  it("los tres campos son obligatorios, fila por fila", () => {
    const result = validateManualSources([
      { url: "https://a.com", title: "A", snippet: "Resumen" },
      { url: "a.com", title: " ", snippet: "" },
    ]);
    expect(result.body).toBeNull();
    expect(result.rowErrors[0]).toEqual({});
    expect(result.rowErrors[1]).toEqual({
      url: "Tiene que ser una URL válida que empiece con http:// o https://.",
      title: "Obligatorio.",
      snippet: "Obligatorio.",
    });
  });

  it("sin filas no se puede enviar", () => {
    expect(validateManualSources([]).formError).toBe("Agregá al menos una fuente.");
  });

  it("body exacto { manualSources }, recortado", () => {
    expect(validateManualSources([{ url: " https://a.com/x ", title: " Título ", snippet: " Texto " }]).body).toEqual({
      manualSources: [{ url: "https://a.com/x", title: "Título", snippet: "Texto" }],
    });
  });
});

describe("agentes afectados", () => {
  function round(agentIds: string[]): DebateRound {
    return {
      id: `r-${agentIds.join("-")}`,
      round: 1,
      type: "OPENING",
      arguments: agentIds.map((agentId, index) => ({
        id: `arg-${agentId}-${index}`,
        agentId,
        content: "x",
        origin: "AI_GENERATED",
        respondsToId: null,
        createdAt: `2026-09-28T10:0${index}:00.000Z`,
      })),
    };
  }

  it("VALIDATION_INCONSISTENCY: el debatiente sin argumentos aprobados, nunca el juez", () => {
    const detail = makeEpisodeDetail({ debate: { rounds: [round([AGENT_A])], verdict: null } });
    expect(agentsWithoutOfficialArguments(detail).map((agent) => agent.agentId)).toEqual([AGENT_B]);
  });

  it("VALIDATION_INCONSISTENCY: nadie si todos tienen argumentos", () => {
    const detail = makeEpisodeDetail({ debate: { rounds: [round([AGENT_A, AGENT_B])], verdict: null } });
    expect(agentsWithoutOfficialArguments(detail)).toEqual([]);
  });

  it("VOICE_NOT_CONFIGURED: todos los participantes mientras no exista API-18", () => {
    expect(agentsToReviewForVoices(makeEpisodeDetail()).map((agent) => agent.agentId)).toEqual([AGENT_A, AGENT_B, JUDGE]);
  });
});

describe("tras reanudar (AC 3.53)", () => {
  it("vuelve a SSE en las fases del debate y a polling desde GENERATING_AUDIO", () => {
    // La respuesta de resume sale con pipelineActive en true; el refetch del
    // detalle decide el modo con la lógica de la vista en vivo.
    expect(liveUpdateMode("RESEARCHING", true)).toBe("sse");
    expect(liveUpdateMode("DEBATING", true)).toBe("sse");
    expect(liveUpdateMode("GENERATING_AUDIO", true)).toBe("polling");
  });
});

describe("activeResolution (AC 3.51, AC 3.55)", () => {
  type Checkpoint = EpisodeDetail["checkpoints"][number];
  function checkpoint(reason: string, createdAt: string): Checkpoint {
    // Un motivo que la API todavía no documenta llega como string suelto.
    return { reason: reason as Checkpoint["reason"], fromState: "DEBATING", debateRoundId: null, createdAt };
  }

  it("solo en REQUIRES_HUMAN_REVIEW", () => {
    const checkpoints = [checkpoint("MAX_REVISIONS_EXCEEDED", "2026-09-28T10:00:00.000Z")];
    expect(activeResolution(makeEpisodeDetail({ status: "PENDING_REVIEW", checkpoints }))).toBeNull();
    expect(activeResolution(makeEpisodeDetail({ status: "FAILED", checkpoints }))).toBeNull();
  });

  it("lo decide la tabla de acciones: existe justo donde se puede reanudar (AC 3.42)", () => {
    const checkpoints = [checkpoint("MAX_REVISIONS_EXCEEDED", "2026-09-28T10:00:00.000Z")];
    for (const status of EPISODE_STATUSES) {
      expect(activeResolution(makeEpisodeDetail({ status, checkpoints })) !== null, status).toBe(
        canRunAction(status, "resume"),
      );
    }
  });

  it("se resuelve sobre el checkpoint más reciente, sin depender del orden de la API", () => {
    const resolution = activeResolution(
      makeEpisodeDetail({
        status: "REQUIRES_HUMAN_REVIEW",
        checkpoints: [
          checkpoint("INSUFFICIENT_EVIDENCE", "2026-09-28T12:00:00.000Z"),
          checkpoint("USAGE_LIMIT_EXCEEDED", "2026-09-28T10:00:00.000Z"),
        ],
      }),
    );
    expect(resolution?.checkpoint?.reason).toBe("INSUFFICIENT_EVIDENCE");
    expect(resolution?.kind).toBe("insufficient-evidence");
  });

  it("motivo desconocido o sin checkpoints: panel genérico", () => {
    const unknown = activeResolution(
      makeEpisodeDetail({
        status: "REQUIRES_HUMAN_REVIEW",
        checkpoints: [checkpoint("SOMETHING_NEW", "2026-09-28T10:00:00.000Z")],
      }),
    );
    expect(unknown?.kind).toBe("unknown");
    expect(unknown?.checkpoint?.reason).toBe("SOMETHING_NEW");
    expect(activeResolution(makeEpisodeDetail({ status: "REQUIRES_HUMAN_REVIEW", checkpoints: [] }))).toEqual({
      checkpoint: null,
      kind: "unknown",
    });
  });
});
