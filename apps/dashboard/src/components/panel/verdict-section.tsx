"use client";

import { TriangleAlert } from "lucide-react";
import { useRef, type RefObject } from "react";
import { debateLanguageTag } from "@/lib/debate-language";
import type { ReviewControls } from "@/lib/episode-actions";
import { showStaleVerdictWarning, verdictParties, type EpisodeDetail } from "@/lib/episode-detail";
import { cn } from "@/lib/utils";
import { RejudgeControl, RejudgeProgress } from "./rejudge";
import type { EpisodeActions } from "./use-episode-actions";

/** Controles de revisión del veredicto; solo en PENDING_REVIEW (AC 3.42). */
export interface VerdictReview {
  actions: EpisodeActions;
  controls: ReviewControls;
}

/**
 * Veredicto (AC 3.29): juez, ganador o "Sin ganador" y el texto, marcado con
 * el idioma del episodio (AC 3.79 b). En PENDING_REVIEW con
 * `debate.verdict.stale`, el aviso de veredicto desactualizado (AC 3.81), y
 * en PENDING_REVIEW "Volver a juzgar" (AC 3.82-3.85).
 */
export function VerdictSection({
  detail,
  review,
  blockRef: externalBlockRef,
}: {
  detail: EpisodeDetail;
  review?: VerdictReview;
  /** El bloque del veredicto, destino del foco al volver a juzgar (también desde "Aprobar", AC 3.84). */
  blockRef?: RefObject<HTMLDivElement | null>;
}) {
  const { verdict } = detail.debate;
  const internalBlockRef = useRef<HTMLDivElement>(null);
  const blockRef = externalBlockRef ?? internalBlockRef;
  const judging = review?.actions.pending?.action === "regenerate-verdict";

  return (
    <section aria-labelledby="verdict-heading" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 id="verdict-heading" className="text-lg font-semibold">
          Veredicto
        </h2>
        {review && (
          <div className="max-w-sm">
            <RejudgeControl
              actions={review.actions}
              budget={review.controls.budget}
              highlighted={review.controls.staleVerdict}
              focusAfterConfirm={() => blockRef.current}
            />
          </div>
        )}
      </div>
      {/* tabIndex -1: destino del foco al confirmar "Volver a juzgar". */}
      <div
        ref={blockRef}
        tabIndex={-1}
        className="rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {/* role="status": "Juzgando…" y el aviso de AC 3.81 aparecen sin recargar, y así se anuncian. */}
        <div role="status">
          {judging && (
            <div className="mb-3">
              <RejudgeProgress />
            </div>
          )}
        </div>
        {verdict === null ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
            Todavía no hay veredicto.
          </p>
        ) : (
          <VerdictBody detail={detail} verdict={verdict} dimmed={judging} />
        )}
      </div>
    </section>
  );
}

function VerdictBody({
  detail,
  verdict,
  dimmed,
}: {
  detail: EpisodeDetail;
  verdict: NonNullable<EpisodeDetail["debate"]["verdict"]>;
  dimmed: boolean;
}) {
  const { judgeName, winnerName } = verdictParties(detail.participants, verdict);
  return (
    <div
      aria-busy={dimmed}
      className={cn("space-y-3 rounded-lg border bg-card p-4 text-card-foreground", dimmed && "opacity-60")}
    >
      <div role="status">
        {showStaleVerdictWarning(detail) && (
          <p className="flex items-start gap-2 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-sm">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Este veredicto es anterior a cambios en los argumentos y puede no reflejar el debate final.
          </p>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Juez</dt>
        <dd>{judgeName}</dd>
        <dt className="text-muted-foreground">Ganador</dt>
        <dd className="font-medium">{winnerName ?? "Sin ganador"}</dd>
      </dl>
      <p lang={debateLanguageTag(detail.language)} className="text-sm leading-relaxed whitespace-pre-wrap">
        {verdict.content}
      </p>
    </div>
  );
}
