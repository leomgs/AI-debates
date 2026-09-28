import { TriangleAlert } from "lucide-react";
import { debateLanguageTag } from "@/lib/debate-language";
import { showStaleVerdictWarning, verdictParties, type EpisodeDetail } from "@/lib/episode-detail";

/**
 * Veredicto (AC 3.29): juez, ganador o "Sin ganador" y el texto, marcado con
 * el idioma del episodio (AC 3.79 b). En PENDING_REVIEW con
 * `debate.verdict.stale`, el aviso de veredicto desactualizado (AC 3.81); el
 * botón "Volver a juzgar" es del bloque F2-C.
 */
export function VerdictSection({ detail }: { detail: EpisodeDetail }) {
  const { verdict } = detail.debate;
  return (
    <section aria-labelledby="verdict-heading" className="space-y-3">
      <h2 id="verdict-heading" className="text-lg font-semibold">
        Veredicto
      </h2>
      {verdict === null ? (
        <p className="rounded-md border border-dashed px-4 py-6 text-sm text-muted-foreground">
          Todavía no hay veredicto.
        </p>
      ) : (
        <VerdictBody detail={detail} verdict={verdict} />
      )}
    </section>
  );
}

function VerdictBody({
  detail,
  verdict,
}: {
  detail: EpisodeDetail;
  verdict: NonNullable<EpisodeDetail["debate"]["verdict"]>;
}) {
  const { judgeName, winnerName } = verdictParties(detail.participants, verdict);
  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 text-card-foreground">
      {/* role="status": el aviso aparece sin recargar tras un edit o un
          regenerate (refetch de D7), y así se anuncia. */}
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
