"use client";

import { Ban } from "lucide-react";
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
import { ActionErrorMessage } from "./action-feedback";
import { useConfirmFocus } from "./use-confirm-focus";
import type { EpisodeActions } from "./use-episode-actions";

/**
 * "Rechazar" (AC 3.47): acción destructiva, con un diálogo que explica que el
 * episodio pasa a Cancelado y no se puede deshacer. Vale en PENDING_REVIEW y
 * en REQUIRES_HUMAN_REVIEW. Mientras corre otra acción, se deshabilita
 * (AC 3.49).
 */
export function RejectButton({
  actions,
  focusAfterConfirm,
}: {
  actions: EpisodeActions;
  /** Dónde queda el foco al confirmar (el botón se deshabilita mientras corre). */
  focusAfterConfirm: () => HTMLElement | null;
}) {
  const focus = useConfirmFocus(focusAfterConfirm);
  const pending = actions.pending?.action === "reject";
  const failure = actions.errorFor((request) => request.action === "reject");

  return (
    <div className="space-y-2">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={actions.pending !== null}
          >
            <Ban aria-hidden="true" />
            {pending ? "Rechazando…" : "Rechazar"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent onCloseAutoFocus={focus.onCloseAutoFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Rechazar el episodio?</AlertDialogTitle>
            <AlertDialogDescription>
              El episodio pasa a Cancelado y no se puede deshacer: no se va a poder reanudar, aprobar ni publicar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                focus.markConfirmed();
                actions.run({ action: "reject" });
              }}
            >
              Rechazar el episodio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {failure && <ActionErrorMessage view={failure} />}
    </div>
  );
}
