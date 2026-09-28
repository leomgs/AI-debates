"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Checkpoint, EpisodeDetail } from "@/lib/episode-detail";
import {
  USAGE_LIMIT_FIELDS,
  USAGE_METRIC_LABELS,
  exhaustedMetrics,
  initialUsageLimitValues,
  usageLimitMode,
  validateUsageLimitForm,
  type UsageLimitField,
  type UsageLimitFormValues,
} from "@/lib/resume-resolution";
import { RepeatReasonWarning, ResumeButton, ResumeError, useResumeFailure } from "./resume-controls";
import type { EpisodeActions } from "./use-episode-actions";

/**
 * USAGE_LIMIT_EXCEEDED (AC 3.51): qué métrica llegó al límite y el
 * formulario para subir `maxLlmCalls` y/o `maxSearchQueries`, precargado con
 * los límites actuales. Sin API-16 no se puede subir `maxTtsSegments`: si lo
 * agotado es TTS, solo queda "Rechazar".
 */
export function UsageLimitResolution({
  detail,
  checkpoint,
  actions,
}: {
  detail: EpisodeDetail;
  checkpoint: Checkpoint;
  actions: EpisodeActions;
}) {
  const exhausted = exhaustedMetrics(detail.usage, detail.limits);
  const mode = usageLimitMode(detail, checkpoint);

  return (
    <div className="space-y-4">
      <div className="space-y-1 text-sm">
        <p>Se agotó el presupuesto propio del episodio (no es la cuota del proveedor).</p>
        {exhausted.length > 0 ? (
          <ul className="list-disc pl-5">
            {exhausted.map((metric) => (
              <li key={metric.key}>
                {USAGE_METRIC_LABELS[metric.key]}: usadas {metric.used} de {metric.limit} (límite alcanzado).
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">
            Ninguna métrica figura en el límite con el consumo actual; revisá el uso del presupuesto.
          </p>
        )}
      </div>
      {mode === "tts-reject-only" ? (
        <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
          Lo que se agotó son los segmentos de audio (TTS), y ese límite todavía no se puede subir desde el panel. Por
          ahora la única opción es rechazar el episodio.
        </p>
      ) : (
        <UsageLimitForm detail={detail} actions={actions} />
      )}
    </div>
  );
}

function UsageLimitForm({ detail, actions }: { detail: EpisodeDetail; actions: EpisodeActions }) {
  const [values, setValues] = useState<UsageLimitFormValues>(() => initialUsageLimitValues(detail.limits));
  // Los errores de cada campo se muestran recién después del primer intento
  // de envío: precargado, el límite agotado ya es inválido y no hace falta
  // marcarlo en rojo antes de que el curador lo toque.
  const [attempted, setAttempted] = useState(false);
  const inputRefs = useRef(new Map<UsageLimitField, HTMLInputElement>());
  const idPrefix = useId();
  const warningId = `${idPrefix}-aviso`;
  const formErrorId = `${idPrefix}-error`;
  const failure = useResumeFailure(actions);
  const validation = validateUsageLimitForm(values, detail);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actions.pending !== null) return;
    setAttempted(true);
    if (validation.body === null) {
      // AC 3.53: no se envía hasta ser válido; el foco va al primer campo con error.
      const firstInvalid = USAGE_LIMIT_FIELDS.find(({ field }) => validation.fieldErrors[field] !== undefined);
      inputRefs.current.get(firstInvalid?.field ?? USAGE_LIMIT_FIELDS[0].field)?.focus();
      return;
    }
    actions.run({ action: "resume", body: validation.body });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <fieldset className="space-y-3" aria-describedby={attempted && validation.formError ? formErrorId : undefined}>
        <legend className="mb-1 text-sm font-medium">Nuevos límites</legend>
        <p className="text-xs text-muted-foreground">
          Cada límite tiene que ser mayor que el consumo actual. Un límite que no cambies no se modifica.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {USAGE_LIMIT_FIELDS.map(({ field, metric, label }) => {
            const inputId = `${idPrefix}-${field}`;
            const hintId = `${inputId}-consumo`;
            const errorId = `${inputId}-error`;
            const error = attempted ? validation.fieldErrors[field] : undefined;
            return (
              <div key={field} className="space-y-1.5">
                <Label htmlFor={inputId}>{label}</Label>
                <Input
                  ref={(element) => {
                    if (element) inputRefs.current.set(field, element);
                    else inputRefs.current.delete(field);
                  }}
                  id={inputId}
                  name={field}
                  inputMode="numeric"
                  autoComplete="off"
                  value={values[field]}
                  onChange={(event) => {
                    setValues((current) => ({ ...current, [field]: event.target.value }));
                    if (failure) actions.clearFailure();
                  }}
                  aria-invalid={error !== undefined}
                  aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                />
                <p id={hintId} className="text-xs text-muted-foreground">
                  Consumo actual: {detail.usage?.[metric] ?? 0}.
                </p>
                {error && (
                  <p id={errorId} className="text-xs text-destructive">
                    {error}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        {attempted && validation.formError && (
          <p id={formErrorId} role="alert" className="text-sm text-destructive">
            {validation.formError}
          </p>
        )}
      </fieldset>
      <ResumeError failure={failure} />
      <RepeatReasonWarning reason="USAGE_LIMIT_EXCEEDED" id={warningId} />
      <ResumeButton actions={actions} describedBy={warningId} />
    </form>
  );
}
