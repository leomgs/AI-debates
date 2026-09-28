"use client";

import { CircleDot, LoaderCircle, Radio, WifiOff, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { debateLanguageTag, type AnyDebateLanguage } from "@/lib/debate-language";
import { formatAbsoluteDate, formatTimeOfDay } from "@/lib/dates";
import type { Participant } from "@/lib/episode-detail";
import type { StreamConnectionState } from "@/lib/episode-event-stream";
import { feedLine, type FeedEntry } from "@/lib/episode-events";
import { cn } from "@/lib/utils";

type IndicatorKey = StreamConnectionState | "ended";

const INDICATORS: Readonly<Record<IndicatorKey, { label: string; Icon: LucideIcon; className: string }>> = {
  connecting: { label: "Conectando…", Icon: LoaderCircle, className: "text-muted-foreground motion-safe:[&>svg]:animate-spin" },
  live: { label: "En vivo", Icon: Radio, className: "border-primary/60 text-foreground" },
  disconnected: { label: "Desconectado", Icon: WifiOff, className: "border-destructive/50 text-destructive" },
  closed: { label: "Desconectado", Icon: WifiOff, className: "border-destructive/50 text-destructive" },
  ended: { label: "Transmisión finalizada", Icon: CircleDot, className: "text-muted-foreground" },
};

/**
 * Vista en vivo (AC 3.32, AC 3.33, AC 3.37): indicador de conexión y feed
 * de actividad traducido, más nuevo primero. `active` es false cuando el
 * episodio ya salió de las fases con SSE: el feed acumulado queda a la vista
 * como "Transmisión finalizada".
 */
export function LiveActivity({
  feed,
  connection,
  active,
  participants,
  language,
}: {
  feed: readonly FeedEntry[];
  connection: StreamConnectionState;
  active: boolean;
  participants: readonly Participant[];
  language: AnyDebateLanguage;
}) {
  const lang = debateLanguageTag(language);
  return (
    <section aria-labelledby="live-heading" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="live-heading" className="text-lg font-semibold">
          Actividad en vivo
        </h2>
        <ConnectionIndicator state={active ? connection : "ended"} />
      </div>
      <p className="text-xs text-muted-foreground">
        Muestra solo la actividad desde que abriste esta pantalla; el estado completo del episodio está en el resto de la
        página.
      </p>
      {feed.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hubo actividad.</p>}
      {/* Siempre montada, para que el lector de pantalla anuncie lo que se
          agrega. Con scroll propio, así que recibe foco para desplazarla con
          el teclado (AC 3.77). */}
      <ol
        aria-live="polite"
        aria-relevant="additions"
        aria-labelledby="live-heading"
        tabIndex={feed.length > 0 ? 0 : undefined}
        className="max-h-72 space-y-2 overflow-y-auto rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {feed.map((entry) => {
          const { text, quote } = feedLine(entry.event, participants);
          return (
            <li key={entry.id} className="flex gap-3 text-sm">
              <time
                dateTime={entry.receivedAt}
                title={formatAbsoluteDate(entry.receivedAt)}
                className="shrink-0 text-xs text-muted-foreground tabular-nums leading-5"
              >
                {formatTimeOfDay(entry.receivedAt)}
              </time>
              <span className="min-w-0">
                {text}
                {quote && (
                  <span lang={lang} className="block truncate text-muted-foreground">
                    “{quote}”
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function ConnectionIndicator({ state }: { state: IndicatorKey }) {
  const { label, Icon, className } = INDICATORS[state];
  // Lo que anuncia el lector de pantalla: "Conectando…" no se anuncia (con
  // la espera creciente se repetiría en cada intento), así que mientras
  // conecta queda el último texto anunciado. Se ajusta durante el render
  // (patrón "guardar el valor anterior" de la guía de React), sin efecto.
  const [announced, setAnnounced] = useState(label);
  if (state !== "connecting" && announced !== label) setAnnounced(label);

  return (
    <p
      data-state={state}
      className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", className)}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span aria-hidden="true">{label}</span>
      <span role="status" className="sr-only">
        {announced}
      </span>
    </p>
  );
}
