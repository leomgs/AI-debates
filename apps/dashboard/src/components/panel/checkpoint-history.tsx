import { checkpointReasonLabel } from "@/lib/checkpoint-reasons";
import { formatAbsoluteDate } from "@/lib/dates";
import { checkpointRound, roundLabel, sortCheckpoints, type EpisodeDetail } from "@/lib/episode-detail";
import { episodeStatusUi } from "@/lib/episode-status";

/**
 * Historial de interrupciones (AC 3.31; US 5.4): de más vieja a más nueva,
 * con el motivo en español, la fase desde la que se interrumpió, la ronda si
 * aplica y la fecha.
 */
export function CheckpointHistory({
  checkpoints,
  rounds,
}: {
  checkpoints: EpisodeDetail["checkpoints"];
  rounds: EpisodeDetail["debate"]["rounds"];
}) {
  const sorted = sortCheckpoints(checkpoints);
  return (
    <section aria-labelledby="checkpoints-heading" className="space-y-3">
      <h2 id="checkpoints-heading" className="text-lg font-semibold">
        Interrupciones
      </h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin interrupciones.</p>
      ) : (
        <ol className="space-y-3">
          {sorted.map((checkpoint, index) => {
            const round = checkpointRound(rounds, checkpoint);
            return (
              <li key={`${checkpoint.createdAt}-${index}`} className="space-y-1 rounded-md border px-3 py-2 text-sm">
                <p className="font-medium">{checkpointReasonLabel(checkpoint.reason)}</p>
                <p className="text-muted-foreground">
                  Se interrumpió en: {episodeStatusUi(checkpoint.fromState).label}
                  {round !== null && ` · ${roundLabel(round)}`}
                </p>
                <p className="text-xs text-muted-foreground">
                  <time dateTime={checkpoint.createdAt}>{formatAbsoluteDate(checkpoint.createdAt)}</time>
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
