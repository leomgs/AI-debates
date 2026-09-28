"use client";

import { LoaderCircle, Pencil, RefreshCw } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  editDraftState,
  isArgumentAction,
  lastLlmCallWarning,
  llmBudgetSummary,
  type ReviewControls,
} from "@/lib/episode-actions";
import type { DebateArgument } from "@/lib/episode-detail";
import { ActionErrorMessage } from "./action-feedback";
import { useConfirmFocus } from "./use-confirm-focus";
import type { EpisodeActions } from "./use-episode-actions";

/**
 * Lo que necesita cada argumento para sus controles de curaduría; solo en
 * PENDING_REVIEW (AC 3.42). `editingArgumentId` vive en el detalle: solo un
 * argumento puede estar en edición a la vez (AC 3.44).
 */
export interface ArgumentReview {
  actions: EpisodeActions;
  controls: ReviewControls;
  editingArgumentId: string | null;
  onEditingChange: (argumentId: string | null) => void;
  /** Id de la explicación de "Regenerar" deshabilitado (AC 3.46), si aplica. */
  budgetNoteId?: string;
}

/** Hay una acción en curso sobre este argumento: "Regenerando…" o "Guardando…". */
export function argumentBusy(review: ArgumentReview, argumentId: string): boolean {
  return isArgumentAction(review.actions.pending ?? undefined, argumentId);
}

/**
 * "Editar" y "Regenerar" de un argumento (AC 3.44-3.46). Mientras corre
 * cualquier acción del episodio, los dos se deshabilitan (AC 3.49).
 */
export function ArgumentControls({
  argument,
  review,
  agentLabel,
  editButtonRef,
  focusAfterRegenerate,
}: {
  argument: DebateArgument;
  review: ArgumentReview;
  agentLabel: string;
  editButtonRef: Ref<HTMLButtonElement>;
  /** El argumento, que muestra "Regenerando…" mientras corre. */
  focusAfterRegenerate: () => HTMLElement | null;
}) {
  const { actions, editingArgumentId } = review;
  const regenerating = actions.pending?.action === "regenerate" && actions.pending.argumentId === argument.id;
  const failure = actions.errorFor(
    (request) => request.action === "regenerate" && request.argumentId === argument.id,
  );
  const anotherInEdit = editingArgumentId !== null && editingArgumentId !== argument.id;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={editButtonRef}
          variant="outline"
          size="sm"
          disabled={actions.pending !== null || anotherInEdit}
          onClick={() => {
            actions.clearFailure();
            review.onEditingChange(argument.id);
          }}
          aria-label={`Editar el argumento de ${agentLabel}`}
        >
          <Pencil aria-hidden="true" />
          Editar
        </Button>
        <RegenerateArgumentButton
          argument={argument}
          review={review}
          agentLabel={agentLabel}
          focusAfterConfirm={focusAfterRegenerate}
        />
        {anotherInEdit && (
          <span className="text-xs text-muted-foreground">Hay otro argumento en edición.</span>
        )}
      </div>
      <p role="status" className="text-sm">
        {regenerating && (
          <span className="flex items-center gap-2">
            <LoaderCircle aria-hidden="true" className="size-4 shrink-0 motion-safe:animate-spin" />
            Regenerando…
          </span>
        )}
      </p>
      {failure && <ActionErrorMessage view={failure} />}
    </div>
  );
}

/**
 * "Regenerar" (AC 3.45): confirmación con los tres avisos y el consumo a la
 * vista (edge case "Presupuesto agotado en PENDING_REVIEW"). Deshabilitado
 * con el presupuesto LLM agotado (AC 3.46).
 */
function RegenerateArgumentButton({
  argument,
  review,
  agentLabel,
  focusAfterConfirm,
}: {
  argument: DebateArgument;
  review: ArgumentReview;
  agentLabel: string;
  focusAfterConfirm: () => HTMLElement | null;
}) {
  const { actions, controls } = review;
  const focus = useConfirmFocus(focusAfterConfirm);
  const lastCall = lastLlmCallWarning(controls.budget);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={!controls.llmActionsEnabled || actions.pending !== null}
          aria-label={`Regenerar el argumento de ${agentLabel}`}
          aria-describedby={controls.llmActionsEnabled ? undefined : review.budgetNoteId}
        >
          <RefreshCw aria-hidden="true" />
          Regenerar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent onCloseAutoFocus={focus.onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Regenerar el argumento de {agentLabel}?</AlertDialogTitle>
          <AlertDialogDescription>El agente vuelve a escribir este argumento.</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Reemplaza el texto actual del argumento.</li>
          <li>
            Consume 1 llamada LLM del presupuesto del episodio. {llmBudgetSummary(controls.budget)}
          </li>
          <li>El texto nuevo no pasa por el fact-checker.</li>
        </ul>
        {lastCall && (
          <p className="rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-sm">{lastCall}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              focus.markConfirmed();
              actions.run({ action: "regenerate", argumentId: argument.id });
            }}
          >
            Regenerar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Editor inline de un argumento (AC 3.44): el texto actual en un textarea
 * que crece con el contenido. "Guardar" se habilita con un cambio real y no
 * vacío; "Cancelar" (o Escape) con cambios sin guardar pide confirmación.
 * Ante un error el borrador queda como estaba.
 */
export function ArgumentEditor({
  argument,
  review,
  agentLabel,
  lang,
  onClose,
}: {
  argument: DebateArgument;
  review: ArgumentReview;
  agentLabel: string;
  lang: string;
  onClose: () => void;
}) {
  const { actions } = review;
  const [draft, setDraft] = useState(argument.content);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const discarded = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();
  const errorId = useId();
  const state = editDraftState(argument.content, draft);
  const saving = actions.pending?.action === "edit" && actions.pending.argumentId === argument.id;
  const failure = actions.errorFor((request) => request.action === "edit" && request.argumentId === argument.id);

  // Al abrir, el foco va al texto, con el cursor al final.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  // Mientras guardaba, "Guardar" estuvo deshabilitado y el foco pudo
  // perderse: con un error nuevo vuelve al texto, que lo describe (AC 3.77).
  const failureMessage = failure?.message ?? null;
  useEffect(() => {
    if (failureMessage !== null) textareaRef.current?.focus();
  }, [failureMessage]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state.canSave || actions.pending !== null) return;
    actions.run({ action: "edit", argumentId: argument.id, content: state.value }, { onSuccess: onClose });
  }

  function cancel() {
    if (saving) return;
    if (state.dirty) setConfirmingDiscard(true);
    else onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2" noValidate>
      <Label htmlFor={textareaId} className="sr-only">
        Texto del argumento de {agentLabel}
      </Label>
      <Textarea
        ref={textareaRef}
        id={textareaId}
        lang={lang}
        value={draft}
        readOnly={saving}
        onChange={(event) => {
          setDraft(event.target.value);
          if (failure) actions.clearFailure();
        }}
        onKeyDown={handleKeyDown}
        aria-invalid={failure !== null}
        aria-describedby={failure ? errorId : undefined}
        className="min-h-32 leading-relaxed"
      />
      {failure && <ActionErrorMessage id={errorId} view={failure} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!state.canSave || actions.pending !== null}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={cancel}>
          Cancelar
        </Button>
        {!state.canSave && !saving && (
          <span className="text-xs text-muted-foreground">
            {state.value === "" ? "El texto no puede quedar vacío." : "Todavía no hay cambios para guardar."}
          </span>
        )}
      </div>
      <AlertDialog open={confirmingDiscard} onOpenChange={setConfirmingDiscard}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // Al descartar, el editor se cierra recién acá, cuando el diálogo
            // ya soltó el foco: así el foco vuelve al botón "Editar".
            if (discarded.current) {
              discarded.current = false;
              event.preventDefault();
              onClose();
              return;
            }
            event.preventDefault();
            textareaRef.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar los cambios?</AlertDialogTitle>
            <AlertDialogDescription>Lo que editaste en este argumento no se guardó y se va a perder.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                discarded.current = true;
              }}
            >
              Descartar cambios
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
