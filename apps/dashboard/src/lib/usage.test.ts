import { describe, expect, it } from "vitest";
import { formatExecutionTime, usageLevel, usageLimitsSummary, usageMetrics, usagePercent } from "./usage";

describe("usageLevel (AC 3.30)", () => {
  it("por debajo del 80 %: ok", () => {
    expect(usageLevel(0, 10)).toBe("ok");
    expect(usageLevel(7, 10)).toBe("ok");
    expect(usageLevel(79, 100)).toBe("ok");
  });

  it("desde el 80 %: cerca del límite", () => {
    expect(usageLevel(8, 10)).toBe("near");
    expect(usageLevel(4, 5)).toBe("near");
    expect(usageLevel(99, 100)).toBe("near");
  });

  it("desde el 100 %: límite alcanzado, también si se pasó", () => {
    expect(usageLevel(10, 10)).toBe("reached");
    expect(usageLevel(12, 10)).toBe("reached");
  });

  it("con límite 0 no queda nada por consumir", () => {
    expect(usageLevel(0, 0)).toBe("reached");
  });
});

describe("usagePercent", () => {
  it("redondea y queda entre 0 y 100", () => {
    expect(usagePercent(1, 3)).toBe(33);
    expect(usagePercent(12, 10)).toBe(100);
    expect(usagePercent(0, 0)).toBe(100);
  });
});

describe("usageMetrics", () => {
  it("las tres barras con su límite y su nivel, en el orden de la spec", () => {
    const metrics = usageMetrics(
      { llmCalls: 24, searchRequests: 5, ttsRequests: 3, executionTime: 0 },
      { maxLlmCalls: 30, maxSearchQueries: 5, maxTtsSegments: 20 },
    );
    expect(metrics.map(({ key, label, used, limit, level, percent }) => [key, label, used, limit, level, percent])).toEqual([
      ["llmCalls", "Llamadas LLM", 24, 30, "near", 80],
      ["searchRequests", "Búsquedas", 5, 5, "reached", 100],
      ["ttsRequests", "Segmentos TTS", 3, 20, "ok", 15],
    ]);
  });

  it("sin consumo, solo los límites", () => {
    expect(usageLimitsSummary({ maxLlmCalls: 30, maxSearchQueries: 5, maxTtsSegments: 20 })).toEqual([
      { label: "Llamadas LLM", limit: 30 },
      { label: "Búsquedas", limit: 5 },
      { label: "Segmentos TTS", limit: 20 },
    ]);
  });
});

describe("formatExecutionTime (AC 3.30, en ms)", () => {
  it("null con 0: la API todavía no lo registra y no se muestra un dato falso", () => {
    expect(formatExecutionTime(0)).toBeNull();
    expect(formatExecutionTime(-5)).toBeNull();
  });

  it("segundos, minutos y horas", () => {
    expect(formatExecutionTime(300)).toBe("menos de 1 s");
    expect(formatExecutionTime(45_400)).toBe("45 s");
    expect(formatExecutionTime(340_000)).toBe("5 min 40 s");
    expect(formatExecutionTime(120_000)).toBe("2 min");
    expect(formatExecutionTime(3_600_000)).toBe("1 h");
    expect(formatExecutionTime(3_900_000)).toBe("1 h 5 min");
  });
});
