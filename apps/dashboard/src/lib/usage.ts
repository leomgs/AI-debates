import type { EpisodeDetail } from "@/lib/episode-detail";

// Uso vs. límites del episodio (spec 003, AC 3.30; US 5.3), sin React.

type Usage = NonNullable<EpisodeDetail["usage"]>;
type Limits = EpisodeDetail["limits"];

/** "ok" por debajo del 80 %, "near" desde el 80 %, "reached" desde el 100 % (AC 3.30). */
export type UsageLevel = "ok" | "near" | "reached";

export const NEAR_LIMIT_RATIO = 0.8;

export const USAGE_LEVEL_LABELS: Readonly<Record<Exclude<UsageLevel, "ok">, string>> = {
  near: "Cerca del límite",
  reached: "Límite alcanzado",
};

/**
 * Nivel de una métrica. Con un límite de 0 (o negativo) no queda nada por
 * consumir: se considera alcanzado.
 */
export function usageLevel(used: number, limit: number): UsageLevel {
  if (limit <= 0 || used >= limit) return "reached";
  return used / limit >= NEAR_LIMIT_RATIO ? "near" : "ok";
}

/** Porcentaje para el ancho de la barra, entre 0 y 100 (el consumo puede pasar el límite). */
export function usagePercent(used: number, limit: number): number {
  if (limit <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
}

export type UsageMetricKey = "llmCalls" | "searchRequests" | "ttsRequests";

export interface UsageMetric {
  key: UsageMetricKey;
  label: string;
  used: number;
  limit: number;
  level: UsageLevel;
  percent: number;
}

const METRICS: ReadonlyArray<{ key: UsageMetricKey; label: string; limitKey: keyof Limits }> = [
  { key: "llmCalls", label: "Llamadas LLM", limitKey: "maxLlmCalls" },
  { key: "searchRequests", label: "Búsquedas", limitKey: "maxSearchQueries" },
  { key: "ttsRequests", label: "Segmentos TTS", limitKey: "maxTtsSegments" },
];

/** Las tres barras de AC 3.30, en el orden de la spec. */
export function usageMetrics(usage: Usage, limits: Limits): UsageMetric[] {
  return METRICS.map(({ key, label, limitKey }) => {
    const used = usage[key];
    const limit = limits[limitKey];
    return { key, label, used, limit, level: usageLevel(used, limit), percent: usagePercent(used, limit) };
  });
}

/** Límites sin consumo registrado (`usage` null): se muestran sin inventar ceros. */
export function usageLimitsSummary(limits: Limits): Array<{ label: string; limit: number }> {
  return METRICS.map(({ label, limitKey }) => ({ label, limit: limits[limitKey] }));
}

/**
 * `executionTime` legible, en min/s (AC 3.30). La API lo da en milisegundos
 * (api-contract.md §2: 340000 → "5 min 40 s").
 */
export function formatExecutionTime(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  if (totalSeconds < 60) return `${totalSeconds} s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return seconds > 0 ? `${totalMinutes} min ${seconds} s` : `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}
