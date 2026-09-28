"use client";

import { Check, Gavel, TriangleAlert } from "lucide-react";
import { useId, useRef } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  APPROVE_STALE_VERDICT_WARNING,
  llmBudgetExhaustedExplanation,
  type ReviewControls,
} from "@/lib/episode-actions";
import { ActionErrorMessage } from "./action-feedback";
import { RejectButton } from "./reject-button";
import { RejudgeDetails } from "./rejudge";
import { useConfirmFocus } from "./use-confirm-focus";
import type { EpisodeActions } from "./use-episode-actions";

/**
 * Panel de curaduría de PENDING_REVIEW (sección 6): "Aprobar" como acción
 * primaria y "Rechazar", destructiva, separada a la derecha (AC 3.47). Editar
 * y regenerar van en cada argumento; volver a juzgar, en el veredicto.
 */
export function ReviewPanel({
  actions,
  controls,
  editing,
  focusVerdict,
}: {
  actions: EpisodeActions;
  controls: ReviewControls;
  /** Hay un argumento en edición: aprobar descartaría el borrador. */
  editing: boolean;
  /** El bloque del veredicto, destino del foco si se vuelve a juzgar desde "Aprobar". */
  focusVerdict: () => HTMLElement | null;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-lg border border-primary/50 bg-card p-4">
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
        Revisión del episodio
      </h2>
      <p className="text-sm text-muted-foreground">
        El debate espera tu revisión. Podés editar o regenerar argumentos y volver a juzgar antes de aprobar.
      </p>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ApproveButton
          actions={actions}
          controls={controls}
          editing={editing}
          focusAfterConfirm={() => headingRef.current}
          focusVerdict={focusVerdict}
        />
        <RejectButton actions={actions} focusAfterConfirm={() => headingRef.current} />
      </div>
    </section>
  );
}

/**
 * "Aprobar" (AC 3.43) con una confirmación breve. Con el veredicto
 * desactualizado, la confirmación lo advierte y ofrece "Volver a juzgar" en
 * el mismo diálogo (AC 3.84). Tras el éxito, el refetch trae APPROVED y la
 * vista pasa sola a polling (AC 3.35).
 */
function ApproveButton({
  actions,
  controls,
  editing,
  focusAfterConfirm,
  focusVerdict,
}: {
  actions: EpisodeActions;
  controls: ReviewControls;
  editing: boolean;
  focusAfterConfirm: () => HTMLElement | null;
  focusVerdict: () => HTMLElement | null;
}) {
  // A dónde va el foco depende de qué se confirmó: aprobar o volver a juzgar.
  const rejudging = useRef(false);
  const focus = useConfirmFocus(() => (rejudging.current ? focusVerdict() : focusAfterConfirm()));
  const editingNoteId = useId();
  const budgetNoteId = useId();
  const pending = actions.pending?.action === "approve";
  const failure = actions.errorFor((request) => request.action === "approve");
  const { budget, staleVerdict, llmActionsEnabled } = controls;

  return (
    <div className="max-w-md space-y-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button disabled={actions.pending !== null || editing} aria-describedby={editing ? editingNoteId : undefined}>
            <Check aria-hidden="true" />
            {pending ? "Aprobando…" : "Aprobar"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent onCloseAutoFocus={focus.onCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aprobar el episodio?</AlertDialogTitle>
            <AlertDialogDescription>
              El episodio pasa a la generación de audio. Después ya no se pueden editar ni regenerar argumentos ni volver
              a juzgar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {staleVerdict && (
            <div className="space-y-2 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-sm">
              <p className="flex items-start gap-2 font-medium">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {APPROVE_STALE_VERDICT_WARNING}
              </p>
              <p>Como alternativa, podés volver a juzgar antes de aprobar:</p>
              <RejudgeDetails budget={budget} />
              {!llmActionsEnabled && (
                <p id={budgetNoteId} className="text-muted-foreground">
                  {llmBudgetExhaustedExplanation(budget)}
                </p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            {staleVerdict && (
              <AlertDialogAction
                variant="outline"
                disabled={!llmActionsEnabled}
                aria-describedby={llmActionsEnabled ? undefined : budgetNoteId}
                onClick={() => {
                  rejudging.current = true;
                  focus.markConfirmed();
                  actions.run({ action: "regenerate-verdict" });
                }}
              >
                <Gavel aria-hidden="true" />
                Volver a juzgar
              </AlertDialogAction>
            )}
            <AlertDialogAction
              onClick={() => {
                rejudging.current = false;
                focus.markConfirmed();
                actions.run({ action: "approve" });
              }}
            >
              {staleVerdict ? "Aprobar igual" : "Aprobar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {editing && (
        <p id={editingNoteId} className="text-xs text-muted-foreground">
          Guardá o cancelá la edición en curso para poder aprobar.
        </p>
      )}
      {failure && <ActionErrorMessage view={failure} />}
    </div>
  );
}
