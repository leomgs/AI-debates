"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  emptyManualSource,
  validateManualSources,
  type ManualSourceDraft,
  type ManualSourceField,
} from "@/lib/resume-resolution";
import { RepeatReasonWarning, ResumeButton, ResumeError, useResumeFailure } from "./resume-controls";
import type { EpisodeActions } from "./use-episode-actions";

const FIELDS: ReadonlyArray<{ field: ManualSourceField; label: string }> = [
  { field: "url", label: "URL" },
  { field: "title", label: "Título" },
  { field: "snippet", label: "Fragmento" },
];

interface SourceRow {
  /** Clave estable de React: las filas se agregan y se quitan. */
  key: number;
  draft: ManualSourceDraft;
}

/**
 * INSUFFICIENT_EVIDENCE (AC 3.51): la investigación encontró menos de 3
 * fuentes válidas. Formulario de fuentes manuales `{ url, title, snippet }`,
 * los tres obligatorios y con URL válida; se pueden agregar y quitar filas.
 * Ante un error lo cargado queda como estaba (AC 3.54).
 */
export function ManualSourcesResolution({ actions }: { actions: EpisodeActions }) {
  const nextKey = useRef(1);
  const [rows, setRows] = useState<SourceRow[]>(() => [{ key: 0, draft: emptyManualSource() }]);
  const [attempted, setAttempted] = useState(false);
  const fieldRefs = useRef(new Map<string, HTMLInputElement | HTMLTextAreaElement>());
  const addButtonRef = useRef<HTMLButtonElement>(null);
  // Tras agregar o quitar una fila, o un envío inválido, a dónde va el foco
  // (AC 3.77). Se aplica después del render, cuando la fila ya existe.
  const focusTarget = useRef<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const idPrefix = useId();
  const warningId = `${idPrefix}-aviso`;
  const failure = useResumeFailure(actions);
  const validation = validateManualSources(rows.map((row) => row.draft));

  useEffect(() => {
    const target = focusTarget.current;
    if (target === null) return;
    focusTarget.current = null;
    const element = target === "add" ? addButtonRef.current : fieldRefs.current.get(target);
    element?.focus();
  }, [focusRequest]);

  function setFocusTarget(target: string) {
    focusTarget.current = target;
    setFocusRequest((count) => count + 1);
  }

  function fieldKey(rowKey: number, field: ManualSourceField) {
    return `${rowKey}-${field}`;
  }

  function update(rowKey: number, field: ManualSourceField, value: string) {
    setRows((current) =>
      current.map((row) => (row.key === rowKey ? { ...row, draft: { ...row.draft, [field]: value } } : row)),
    );
    if (failure) actions.clearFailure();
  }

  function addRow() {
    const key = nextKey.current++;
    setRows((current) => [...current, { key, draft: emptyManualSource() }]);
    setFocusTarget(fieldKey(key, "url"));
  }

  function removeRow(index: number) {
    const previous = rows[index - 1];
    setRows((current) => current.filter((_, position) => position !== index));
    setFocusTarget(previous ? fieldKey(previous.key, "url") : "add");
    if (failure) actions.clearFailure();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (actions.pending !== null) return;
    setAttempted(true);
    if (validation.body === null) {
      // AC 3.53: no se envía hasta ser válido; el foco va al primer campo con error.
      const rowIndex = validation.rowErrors.findIndex((errors) => Object.keys(errors).length > 0);
      const row = rows[rowIndex];
      const field = row && FIELDS.find(({ field: name }) => validation.rowErrors[rowIndex][name] !== undefined);
      setFocusTarget(row && field ? fieldKey(row.key, field.field) : "add");
      return;
    }
    actions.run({ action: "resume", body: validation.body });
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <p className="text-sm">
        La investigación encontró menos de 3 fuentes válidas. Podés agregar fuentes a mano para que el debate siga con
        ellas.
      </p>
      <ol className="space-y-4">
        {rows.map((row, index) => {
          const errors = attempted ? (validation.rowErrors[index] ?? {}) : {};
          return (
            <li key={row.key}>
              <fieldset className="space-y-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Fuente {index + 1}</legend>
                {FIELDS.map(({ field, label }) => {
                  const inputId = `${idPrefix}-${row.key}-${field}`;
                  const errorId = `${inputId}-error`;
                  const error = errors[field];
                  const common = {
                    id: inputId,
                    value: row.draft[field],
                    "aria-invalid": error !== undefined,
                    "aria-describedby": error ? errorId : undefined,
                  };
                  const setRef = (element: HTMLInputElement | HTMLTextAreaElement | null) => {
                    if (element) fieldRefs.current.set(fieldKey(row.key, field), element);
                    else fieldRefs.current.delete(fieldKey(row.key, field));
                  };
                  return (
                    <div key={field} className="space-y-1.5">
                      <Label htmlFor={inputId}>{label}</Label>
                      {field === "snippet" ? (
                        <Textarea
                          {...common}
                          ref={setRef}
                          rows={2}
                          onChange={(event) => update(row.key, field, event.target.value)}
                        />
                      ) : (
                        <Input
                          {...common}
                          ref={setRef}
                          type={field === "url" ? "url" : "text"}
                          inputMode={field === "url" ? "url" : undefined}
                          autoComplete="off"
                          placeholder={field === "url" ? "https://…" : undefined}
                          onChange={(event) => update(row.key, field, event.target.value)}
                        />
                      )}
                      {error && (
                        <p id={errorId} className="text-xs text-destructive">
                          {error}
                        </p>
                      )}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={rows.length === 1}
                  onClick={() => removeRow(index)}
                  aria-label={`Quitar la fuente ${index + 1}`}
                >
                  <Trash2 aria-hidden="true" />
                  Quitar
                </Button>
              </fieldset>
            </li>
          );
        })}
      </ol>
      <Button ref={addButtonRef} type="button" variant="outline" size="sm" onClick={addRow}>
        <Plus aria-hidden="true" />
        Agregar otra fuente
      </Button>
      {attempted && validation.formError && (
        <p role="alert" className="text-sm text-destructive">
          {validation.formError}
        </p>
      )}
      <ResumeError failure={failure} />
      <RepeatReasonWarning reason="INSUFFICIENT_EVIDENCE" id={warningId} />
      <ResumeButton actions={actions} describedBy={warningId} />
    </form>
  );
}
