"use client";

import { Gavel, LoaderCircle } from "lucide-react";
import { useId } from "react";
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
import { llmBudgetExhaustedExplanation, llmBudgetSummary, type LlmBudget } from "@/lib/episode-actions";
import { ActionErrorMessage } from "./action-feedback";
import { useConfirmFocus } from "./use-confirm-focus";
import type { EpisodeActions } from "./use-episode-actions";

/**
 * Lo que avisa la confirmación de "Volver a juzgar" (AC 3.82): el costo con
 * el consumo a la vista, que reemplaza el veredicto y el ganador, y que
 * puede tardar. Se usa en su diálogo y en el de "Aprobar" (AC 3.84).
 */
export function RejudgeDetails({ budget }: { budget: LlmBudget }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
      <li>El juez vuelve a evaluar el debate con los argumentos actuales.</li>
      <li>Reemplaza el veredicto actual, incluido el ganador.</li>
      <li>Consume 1 llamada LLM del presupuesto del episodio. {llmBudgetSummary(budget)}</li>
      <li>Puede tardar hasta un minuto y medio o más.</li>
    </ul>
  );
}

/**
 * "Volver a juzgar" junto al veredicto (AC 3.82, AC 3.83): siempre en
 * PENDING_REVIEW, destacado si el veredicto está desactualizado (AC 3.81),
 * deshabilitado con el presupuesto LLM agotado y la explicación a la vista.
 * Sus errores (AC 3.85) se muestran debajo; el 409 de transición va arriba
 * de la pantalla (AC 3.48).
 */
export function RejudgeControl({
  actions,
  budget,
  highlighted,
  focusAfterConfirm,
}: {
  actions: EpisodeActions;
  budget: LlmBudget;
  highlighted: boolean;
  /** El bloque del veredicto, que muestra "Juzgando…" mientras corre. */
  focusAfterConfirm: () => HTMLElement | null;
}) {
  const focus = useConfirmFocus(focusAfterConfirm);
  const explanationId = useId();
  const running = actions.pending?.action === "regenerate-verdict";
  const failure = actions.errorFor((request) => request.action === "regenerate-verdict");

  return (
    <div className="space-y-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant={highlighted ? "default" : "outline"}
            size="sm"
            disabled={budget.exhausted || actions.pending !== null}
            aria-describedby={budget.exhausted ? explanationId : undefined}
          >
            <Gavel aria-hidden="true" />
            {running ? "Juzgando…" : "Volver a juzgar"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent onCloseAutoFocus={focus.onCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Volver a juzgar?</AlertDialogTitle>
            <AlertDialogDescription>Confirmá antes de gastar presupuesto del episodio.</AlertDialogDescription>
          </AlertDialogHeader>
          <RejudgeDetails budget={budget} />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                focus.markConfirmed();
                actions.run({ action: "regenerate-verdict" });
              }}
            >
              Volver a juzgar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {budget.exhausted && (
        <p id={explanationId} className="text-xs text-muted-foreground">
          {llmBudgetExhaustedExplanation(budget)}
        </p>
      )}
      {failure && <ActionErrorMessage view={failure} />}
    </div>
  );
}

/**
 * Estado de carga del bloque del veredicto mientras corre "Volver a juzgar"
 * (AC 3.82). La acción es sincrónica y puede esperar al limitador de RPM: la
 * pantalla no corta la espera por su cuenta.
 */
export function RejudgeProgress() {
  return (
    <p className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
      <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
      Juzgando…, puede tardar hasta un par de minutos.
    </p>
  );
}
