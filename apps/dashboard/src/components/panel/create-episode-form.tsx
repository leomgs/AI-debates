"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api/client";
import { unwrap } from "@/lib/api/errors";
import type { components } from "@/lib/api/schema";
import { TOPIC_MAX_LENGTH, createEpisodeErrorView, topicState } from "@/lib/create-episode";
import {
  DEBATE_LANGUAGES,
  DEFAULT_DEBATE_LANGUAGE,
  debateLanguageLabel,
  parseDebateLanguage,
  type DebateLanguage,
} from "@/lib/debate-language";
import { queryKeys } from "@/lib/query-keys";
import { episodeHref } from "@/lib/routes";
import { cn } from "@/lib/utils";

type CreateEpisodeBody = components["schemas"]["CreateEpisodeDto"];

async function createEpisode(body: CreateEpisodeBody) {
  return unwrap(await api.POST("/episodes", { body }));
}

const TOPIC_ID = "create-episode-topic";
const TOPIC_HINT_ID = "create-episode-topic-hint";
const TOPIC_ERROR_ID = "create-episode-topic-error";
const LANGUAGE_NOTE_ID = "create-episode-language-note";
const LANGUAGE_ERROR_ID = "create-episode-language-error";

/** Lista de ids para aria-describedby, sin los que no aplican. */
function ids(...values: Array<string | false | null>): string {
  return values.filter(Boolean).join(" ");
}

// Formulario "Crear episodio" (spec 003, sección 4; AC 3.22-3.25, AC 3.78).
// Ante cualquier error conserva el texto y el idioma elegidos: el estado es
// local y no se toca al fallar.
export function CreateEpisodeForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState<DebateLanguage>(DEFAULT_DEBATE_LANGUAGE);
  const topicRef = useRef<HTMLTextAreaElement>(null);
  const languageRefs = useRef(new Map<DebateLanguage, HTMLInputElement>());
  // Guarda sincrónica contra el doble envío (N1): `disabled` y el estado de
  // la mutación recién se ven en el render siguiente, y dos eventos de
  // submit pueden llegar antes. Se libera solo si falla: tras un éxito el
  // formulario navega y no se vuelve a enviar.
  const submittingRef = useRef(false);

  const mutation = useMutation({
    mutationFn: createEpisode,
    onError: () => {
      submittingRef.current = false;
    },
    onSuccess: (episode) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.episodes.all });
      // AC 3.24: al detalle del episodio recién creado.
      router.push(episodeHref(episode.id));
    },
  });

  const topicInfo = topicState(topic);
  // Mientras navega después de crear, el formulario sigue deshabilitado para
  // no mandar un segundo episodio (AC 3.23).
  const busy = mutation.isPending || mutation.isSuccess;
  // El error corresponde al idioma con el que se envió, no al elegido ahora.
  const errorView = mutation.isError ? createEpisodeErrorView(mutation.error, mutation.variables.language) : null;
  const topicError = errorView?.field === "topic" ? errorView : null;
  const languageError = errorView?.field === "language" ? errorView : null;
  const formError = errorView?.field === "form" ? errorView : null;
  const errorField = errorView?.field ?? null;

  // Foco tras un error (AC 3.77): mientras se envía, los controles están
  // deshabilitados y el foco se pierde en el <body>. Al llegar el error se
  // lleva al control que corresponde: el idioma elegido si el error es del
  // selector, el tópico en los demás casos. Se dispara con cada error nuevo.
  // El idioma enviado es el elegido: cambiar de idioma limpia el error.
  const sentLanguage = mutation.variables?.language ?? null;
  useEffect(() => {
    if (errorField === null) return;
    const target = errorField === "language" && sentLanguage ? languageRefs.current.get(sentLanguage) : topicRef.current;
    target?.focus();
  }, [mutation.error, errorField, sentLanguage]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // AC 3.23: sin envíos duplicados (doble click o Enter repetido).
    if (submittingRef.current || busy || !topicInfo.valid) return;
    submittingRef.current = true;
    // El idioma se manda siempre (AC 3.22; en el tipo generado es requerido).
    mutation.mutate({ topic: topicInfo.value, language });
  }

  // Un error del backend describe lo que se envió; al cambiar un campo deja
  // de aplicar y se limpia. Los valores del formulario no se tocan.
  function clearError() {
    if (mutation.isError) mutation.reset();
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-6" noValidate>
      <div className="space-y-2">
        <Label htmlFor={TOPIC_ID}>Tópico</Label>
        <Textarea
          ref={topicRef}
          id={TOPIC_ID}
          name="topic"
          rows={3}
          autoFocus
          value={topic}
          onChange={(event) => {
            setTopic(event.target.value);
            clearError();
          }}
          disabled={busy}
          aria-invalid={topicInfo.tooLong || topicError !== null}
          aria-describedby={ids(TOPIC_HINT_ID, topicError && TOPIC_ERROR_ID)}
          placeholder="Por ejemplo: ¿La semana laboral de cuatro días mejora la productividad?"
        />
        <p
          id={TOPIC_HINT_ID}
          className={cn("flex justify-between text-xs text-muted-foreground", topicInfo.tooLong && "text-destructive")}
        >
          <span>{topicInfo.tooLong ? `Supera el máximo de ${TOPIC_MAX_LENGTH} caracteres.` : "El tópico del debate."}</span>
          <span>
            {topicInfo.length}/{TOPIC_MAX_LENGTH}
            <span className="sr-only"> caracteres</span>
          </span>
        </p>
        {topicError && (
          <p id={TOPIC_ERROR_ID} role="alert" className="text-sm text-destructive">
            {topicError.message}
          </p>
        )}
      </div>

      <fieldset
        className="space-y-2"
        aria-describedby={ids(LANGUAGE_NOTE_ID, languageError && LANGUAGE_ERROR_ID)}
        disabled={busy}
      >
        <legend className="mb-2 text-sm font-medium">Idioma del debate</legend>
        <div className="flex flex-wrap gap-2">
          {DEBATE_LANGUAGES.map((option) => (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm dark:bg-input/30",
                "has-[:checked]:border-primary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
              )}
            >
              <input
                ref={(element) => {
                  if (element) languageRefs.current.set(option, element);
                  else languageRefs.current.delete(option);
                }}
                type="radio"
                name="language"
                value={option}
                className="size-4 accent-primary"
                checked={language === option}
                onChange={(event) => {
                  const next = parseDebateLanguage(event.target.value);
                  if (next) setLanguage(next);
                  clearError();
                }}
              />
              {debateLanguageLabel(option)}
            </label>
          ))}
        </div>
        <p id={LANGUAGE_NOTE_ID} className="text-xs text-muted-foreground">
          El idioma no se puede cambiar después de crear el episodio.
        </p>
        {languageError && (
          <div id={LANGUAGE_ERROR_ID} role="alert" className="space-y-1 text-sm text-destructive">
            <p>{languageError.message}</p>
            {languageError.detail && <p className="text-xs text-muted-foreground">Detalle: {languageError.detail}</p>}
          </div>
        )}
      </fieldset>

      {formError && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {formError.message}
        </p>
      )}

      <Button type="submit" disabled={busy || !topicInfo.valid}>
        {busy ? "Creando…" : "Crear episodio"}
      </Button>
    </form>
  );
}
