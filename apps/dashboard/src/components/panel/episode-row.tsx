import Link from "next/link";
import { formatAbsoluteDate } from "@/lib/dates";
import type { EpisodeListItem } from "@/lib/episode-list";
import { episodeHref } from "@/lib/routes";
import { LanguageBadge } from "./language-badge";
import { PublishedBadge } from "./published-badge";
import { StatusBadge } from "./status-badge";

// Fila de la lista /studio (AC 3.17): título (el tópico), idioma, estado,
// fecha de creación y "Publicado" si `publishedAt` no es nulo. Toda la fila
// es un link al detalle. El tópico (hasta 300 caracteres) se trunca a una
// línea; el texto completo queda en el `title` y en el nombre accesible del
// link (el truncado es solo visual).
export function EpisodeRow({ episode }: { episode: EpisodeListItem }) {
  return (
    <Link
      href={episodeHref(episode.id)}
      className="flex items-center gap-4 rounded-md px-3 py-3 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium" title={episode.title}>
          {episode.title}
        </span>
        <span className="text-xs text-muted-foreground">
          Creado el <time dateTime={episode.createdAt}>{formatAbsoluteDate(episode.createdAt)}</time>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {episode.publishedAt !== null && <PublishedBadge />}
        <LanguageBadge language={episode.language} />
        <StatusBadge status={episode.status} />
      </span>
    </Link>
  );
}
