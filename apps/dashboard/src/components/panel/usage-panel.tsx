import { OctagonAlert, TriangleAlert } from "lucide-react";
import type { EpisodeDetail } from "@/lib/episode-detail";
import {
  USAGE_LEVEL_LABELS,
  formatExecutionTime,
  usageLimitsSummary,
  usageMetrics,
  type UsageMetric,
} from "@/lib/usage";
import { cn } from "@/lib/utils";

/**
 * Uso vs. límites (AC 3.30; US 5.3): tres barras con el valor numérico,
 * marcadas al 80 % y al 100 %, y el tiempo de ejecución. Con `usage` null
 * no se inventan ceros.
 */
export function UsagePanel({ usage, limits }: { usage: EpisodeDetail["usage"]; limits: EpisodeDetail["limits"] }) {
  return (
    <section aria-labelledby="usage-heading" className="space-y-3">
      <h2 id="usage-heading" className="text-lg font-semibold">
        Uso del presupuesto
      </h2>
      {usage === null ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">Sin consumo registrado.</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            {usageLimitsSummary(limits).map(({ label, limit }) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right tabular-nums">límite {limit}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <>
          <ul className="space-y-4">
            {usageMetrics(usage, limits).map((metric) => (
              <li key={metric.key}>
                <UsageBar metric={metric} />
              </li>
            ))}
          </ul>
          <p className="text-sm">
            <span className="text-muted-foreground">Tiempo de ejecución: </span>
            <span className="tabular-nums">{formatExecutionTime(usage.executionTime)}</span>
          </p>
        </>
      )}
    </section>
  );
}

const LEVEL_BAR_CLASS: Readonly<Record<UsageMetric["level"], string>> = {
  ok: "bg-muted-foreground/70",
  near: "bg-primary",
  reached: "bg-destructive",
};

function UsageBar({ metric }: { metric: UsageMetric }) {
  const { key, label, used, limit, level, percent } = metric;
  const labelId = `uso-${key}`;
  const levelLabel = level === "ok" ? null : USAGE_LEVEL_LABELS[level];
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span id={labelId}>{label}</span>
        <span className="tabular-nums">
          {used} / {limit}
        </span>
      </div>
      <div
        role="meter"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        aria-valuetext={`${used} de ${limit}${levelLabel ? `, ${levelLabel.toLowerCase()}` : ""}`}
        className="h-2 overflow-hidden rounded-full bg-secondary"
      >
        <div className={cn("h-full rounded-full", LEVEL_BAR_CLASS[level])} style={{ width: `${percent}%` }} />
      </div>
      {levelLabel && (
        <p
          aria-hidden="true"
          className={cn(
            "flex items-center gap-1 text-xs font-medium",
            level === "reached" ? "text-destructive" : "text-foreground",
          )}
        >
          {level === "reached" ? <OctagonAlert className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
          {levelLabel}
        </p>
      )}
    </div>
  );
}
