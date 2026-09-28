"use client";

import { CornerDownRight } from "lucide-react";
import type { MouseEvent } from "react";
import { debateLanguageTag } from "@/lib/debate-language";
import {
  ARGUMENT_ORIGIN_LABELS,
  agentName,
  argumentElementId,
  excerpt,
  indexArguments,
  roundLabel,
  sortRounds,
  type DebateArgument,
  type DebateRound,
  type EpisodeDetail,
  type Participant,
} from "@/lib/episode-detail";
import { cn } from "@/lib/utils";

const REFERENCE_EXCERPT_LENGTH = 100;

/**
 * Timeline del debate (AC 3.27, AC 3.28): una sección por ronda, en orden,
 * con cada argumento, su agente y su origen. El contenido va marcado con el
 * idioma del episodio (AC 3.79 b).
 */
export function DebateTimeline({ detail }: { detail: EpisodeDetail }) {
  const rounds = sortRounds(detail.debate.rounds);
  const argumentsById = indexArguments(rounds);
  const lang = debateLanguageTag(detail.language);

  return (
    <section aria-labelledby="debate-heading" className="space-y-6">
      <h2 id="debate-heading" className="text-lg font-semibold">
        Debate
      </h2>
      {rounds.length === 0 ? (
        <p className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
          Todavía no hay argumentos.
        </p>
      ) : (
        rounds.map((round) => (
          <RoundSection
            key={round.id}
            round={round}
            participants={detail.participants}
            argumentsById={argumentsById}
            lang={lang}
          />
        ))
      )}
    </section>
  );
}

function RoundSection({
  round,
  participants,
  argumentsById,
  lang,
}: {
  round: DebateRound;
  participants: readonly Participant[];
  argumentsById: ReadonlyMap<string, DebateArgument>;
  lang: string;
}) {
  const headingId = `ronda-${round.id}`;
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h3 id={headingId} className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        {roundLabel(round)}
      </h3>
      {round.arguments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin argumentos todavía.</p>
      ) : (
        <ol className="space-y-3">
          {round.arguments.map((argument) => (
            <li key={argument.id}>
              <ArgumentCard
                argument={argument}
                participants={participants}
                respondsTo={argument.respondsToId === null ? undefined : (argumentsById.get(argument.respondsToId) ?? null)}
                lang={lang}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ArgumentCard({
  argument,
  participants,
  respondsTo,
  lang,
}: {
  argument: DebateArgument;
  participants: readonly Participant[];
  /** undefined: no responde a nadie; null: responde a un argumento que no está en el debate. */
  respondsTo: DebateArgument | null | undefined;
  lang: string;
}) {
  const authorId = `${argumentElementId(argument.id)}-autor`;
  return (
    // tabIndex -1: destino del salto de AC 3.28, que le lleva el foco.
    <article
      id={argumentElementId(argument.id)}
      tabIndex={-1}
      aria-labelledby={authorId}
      className="scroll-mt-6 space-y-2 rounded-lg border bg-card p-4 text-card-foreground outline-none focus:ring-[3px] focus:ring-ring/50"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id={authorId} className="font-medium">
          {agentName(participants, argument.agentId)}
        </p>
        <OriginBadge origin={argument.origin} />
      </div>
      {respondsTo !== undefined && <ResponseReference target={respondsTo} participants={participants} lang={lang} />}
      <p lang={lang} className="text-sm leading-relaxed whitespace-pre-wrap">
        {argument.content}
      </p>
    </article>
  );
}

function OriginBadge({ origin }: { origin: DebateArgument["origin"] }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        origin === "HUMAN_EDITED" ? "border-primary/60 text-foreground" : "border-border text-muted-foreground",
      )}
    >
      <span className="sr-only">Origen: </span>
      {ARGUMENT_ORIGIN_LABELS[origin]}
    </span>
  );
}

/** "Responde a <agente>: <extracto>", con salto al argumento (AC 3.28). */
function ResponseReference({
  target,
  participants,
  lang,
}: {
  target: DebateArgument | null;
  participants: readonly Participant[];
  lang: string;
}) {
  if (target === null) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <CornerDownRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Responde a un argumento que ya no está en el debate.
      </p>
    );
  }

  const targetId = argumentElementId(target.id);
  // El foco va al argumento (además del scroll), para que con teclado o
  // lector de pantalla se siga leyendo desde ahí (AC 3.77).
  function jump(event: MouseEvent<HTMLAnchorElement>) {
    const element = document.getElementById(targetId);
    if (!element) return;
    event.preventDefault();
    element.scrollIntoView({ block: "start" });
    element.focus({ preventScroll: true });
  }

  return (
    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
      <CornerDownRight aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>
        Responde a{" "}
        <a
          href={`#${targetId}`}
          onClick={jump}
          className="rounded-sm text-foreground underline underline-offset-4 outline-none hover:text-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {agentName(participants, target.agentId)}
        </a>
        : <span lang={lang}>“{excerpt(target.content, REFERENCE_EXCERPT_LENGTH)}”</span>
      </span>
    </p>
  );
}
