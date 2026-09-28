import { Ban, CircleX, Hourglass, RotateCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { checkpointReasonLabel } from "@/lib/checkpoint-reasons";
import { checkpointRound, latestCheckpoint, roundLabel, type EpisodeDetail } from "@/lib/episode-detail";
import { episodeStatusUi } from "@/lib/episode-status";
import type { LiveUpdateMode } from "@/lib/live-updates";
import { POLLING_INTERVALS_MS } from "@/lib/polling";
import { cn } from "@/lib/utils";

/**
 * Aviso de estado arriba del detalle: episodio trabado (AC 3.39), FAILED
 * con el motivo del último checkpoint (AC 3.40), CANCELLED (AC 3.40) o fase
 * que se actualiza por polling (AC 3.35). Nada en los demás casos.
 */
export function EpisodeStatusNotice({
  detail,
  mode,
  onRefresh,
  refreshing,
}: {
  detail: EpisodeDetail;
  mode: LiveUpdateMode;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  if (mode === "stuck") {
    return (
      <Notice tone="attention" icon={<Unplug aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}>
        <p className="font-medium">Detenido por un error interno; se retomará al reiniciar el backend.</p>
        <p className="text-muted-foreground">Mientras tanto la pantalla no se actualiza sola.</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={onRefresh} disabled={refreshing}>
          <RotateCw aria-hidden="true" className={cn(refreshing && "animate-spin")} />
          {refreshing ? "Consultando…" : "Volver a consultar"}
        </Button>
      </Notice>
    );
  }

  if (detail.status === "FAILED") {
    const checkpoint = latestCheckpoint(detail.checkpoints);
    const round = checkpoint ? checkpointRound(detail.debate.rounds, checkpoint) : null;
    return (
      <Notice tone="error" icon={<CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}>
        <p className="font-medium text-destructive">El episodio falló y no se puede recuperar.</p>
        {checkpoint ? (
          <>
            <p>Motivo: {checkpointReasonLabel(checkpoint.reason)}.</p>
            <p className="text-muted-foreground">
              Se interrumpió en: {episodeStatusUi(checkpoint.fromState).label}
              {round !== null && ` · ${roundLabel(round)}`}
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">No hay un motivo registrado.</p>
        )}
      </Notice>
    );
  }

  if (detail.status === "CANCELLED") {
    return (
      <Notice tone="neutral" icon={<Ban aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}>
        <p className="font-medium">Episodio cancelado: lo rechazó el curador.</p>
      </Notice>
    );
  }

  if (mode === "polling") {
    return (
      <Notice tone="neutral" icon={<Hourglass aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}>
        <p>
          {episodeStatusUi(detail.status).label}: esta fase no emite actividad en vivo; la pantalla se actualiza cada{" "}
          {POLLING_INTERVALS_MS.episodeDetail / 1000} s.
        </p>
      </Notice>
    );
  }

  return null;
}

const TONE_CLASS = {
  neutral: "border-border bg-card",
  attention: "border-primary/50 bg-primary/10",
  error: "border-destructive/40 bg-destructive/10",
} as const;

function Notice({
  tone,
  icon,
  children,
}: {
  tone: keyof typeof TONE_CLASS;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-3 rounded-md border px-4 py-3 text-sm", TONE_CLASS[tone])}>
      {icon}
      <div className="space-y-1">{children}</div>
    </div>
  );
}
