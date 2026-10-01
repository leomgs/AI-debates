"use client";

import { ArrowLeft, Clapperboard } from "lucide-react";
import Link from "next/link";
import { useId, useState, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { hasPreview, type EpisodeDetail } from "@/lib/episode-detail";
import { cn } from "@/lib/utils";
import { LanguageBadge } from "./language-badge";
import { PublishedBadge } from "./published-badge";
import { RelativeTime } from "./relative-time";
import { StatusBadge } from "./status-badge";

// A partir de este largo el tópico (hasta 300 caracteres) puede pasar de dos
// líneas: se recorta con la opción de verlo completo (spec 003, edge case
// "Tópico largo").
const LONG_TOPIC_LENGTH = 140;

/**
 * Cabecera del detalle (AC 3.26): tópico, idioma, estado, fecha de creación,
 * "Publicado" si `publishedAt` no es nulo y, desde READY_FOR_RENDER, el
 * acceso al preview. El `<h1>` acepta el foco (`headingRef`): sobrevive a
 * cualquier cambio de estado, así que es a donde va el foco cuando una
 * acción desmonta el panel que lo tenía (AC 3.77).
 */
export function EpisodeHeader({
  detail,
  headingRef,
}: {
  detail: EpisodeDetail;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <header className="space-y-3">
      <Link
        href="/studio"
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Episodios
      </Link>
      <EpisodeTopic title={detail.topic.title} headingRef={headingRef} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={detail.status} />
        <LanguageBadge language={detail.language} />
        {detail.publishedAt !== null && <PublishedBadge />}
        <span className="text-muted-foreground">
          Creado <RelativeTime iso={detail.createdAt} />
        </span>
      </div>
      {hasPreview(detail.status) && <PreviewAccess />}
    </header>
  );
}

function EpisodeTopic({ title, headingRef }: { title: string; headingRef?: Ref<HTMLHeadingElement> }) {
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const long = title.length > LONG_TOPIC_LENGTH;
  return (
    <div className="space-y-1">
      {/* El h1 lleva siempre el texto completo: el recorte es solo visual. */}
      <h1
        id={headingId}
        ref={headingRef}
        tabIndex={-1}
        className={cn("text-2xl font-semibold break-words outline-none", long && !expanded && "line-clamp-2")}
      >
        {title}
      </h1>
      {long && (
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0"
          aria-expanded={expanded}
          aria-controls={headingId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? "Ver menos" : "Ver el tópico completo"}
        </Button>
      )}
    </div>
  );
}

// El preview (/studio/episodes/[id]/preview) es de la F3: hasta entonces el
// acceso se muestra deshabilitado y explicado, en vez de un link a una ruta
// que todavía no existe.
function PreviewAccess() {
  const noteId = useId();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" size="sm" disabled aria-describedby={noteId}>
        <Clapperboard aria-hidden="true" />
        Ver preview
      </Button>
      <p id={noteId} className="text-xs text-muted-foreground">
        El preview con audio todavía no está disponible en el panel.
      </p>
    </div>
  );
}
