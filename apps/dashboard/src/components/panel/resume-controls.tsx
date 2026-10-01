"use client";

import { Play, TriangleAlert } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { CheckpointReason } from "@/lib/checkpoint-reasons";
import type { ActionErrorView } from "@/lib/episode-actions";
import { repeatReasonWarning } from "@/lib/resume-resolution";
import type { EpisodeActions } from "./use-episode-actions";

/**
 * Aviso junto a todo "Reanudar" habilitado (AC 3.52): si el mismo motivo se
 * repite tras reanudar, el episodio pasa a Falló.
 */
export function RepeatReasonWarning({ reason, id }: { reason: CheckpointReason; id?: string }) {
  return (
    <div id={id} className="flex items-start gap-2 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-sm">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="space-y-1">
        {repeatReasonWarning(reason).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}

/**
 * "Reanudar" (AC 3.53). Sin confirmación (AC 3.75): el aviso de repetición
 * está a la vista al lado. Con `type="submit"` lo usan los formularios; sin
 * formulario, `onResume`.
 *
 * Mientras reanuda no se deshabilita con `disabled` sino con
 * `aria-disabled`: así conserva el foco y anuncia "Reanudando…", en vez de
 * dejarlo caer al <body> (AC 3.77). Un click en ese momento no hace nada: la
 * mutación tiene su guarda (AC 3.49) y los formularios no envían con una
 * acción en curso. Al terminar, si el episodio salió del estado, el foco lo
 * mueve useEpisodeActions; si falló, ResumeError.
 */
export function ResumeButton({
  actions,
  describedBy,
  onResume,
}: {
  actions: EpisodeActions;
  describedBy?: string;
  onResume?: () => void;
}) {
  const pending = actions.pending?.action === "resume";
  return (
    <Button
      type={onResume ? "button" : "submit"}
      onClick={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        onResume?.();
      }}
      disabled={actions.pending !== null && !pending}
      aria-disabled={pending || undefined}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
      aria-describedby={describedBy}
    >
      <Play aria-hidden="true" />
      {pending ? "Reanudando…" : "Reanudar"}
    </Button>
  );
}

/** El error de "Reanudar" de este episodio, si lo hay (AC 3.54). */
export function useResumeFailure(actions: EpisodeActions): ActionErrorView | null {
  return actions.errorFor((request) => request.action === "resume");
}

/**
 * Error de "Reanudar" dentro del panel, sin tocar lo cargado: un
 * VALIDATION_ERROR con el mensaje del backend (AC 3.54) o el error genérico.
 * Mientras se reanudaba el botón estaba deshabilitado y el foco se perdió:
 * cuando llega un error nuevo, se lleva al mensaje (AC 3.77).
 */
export function ResumeError({ failure }: { failure: ActionErrorView | null }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const message = failure?.message ?? null;
  useEffect(() => {
    if (message !== null) ref.current?.focus();
  }, [message]);

  if (failure === null) return null;
  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {failure.kind === "validation" ? `El servidor rechazó los datos: ${failure.message}` : failure.message}
    </p>
  );
}
