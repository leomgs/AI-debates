import { Globe } from "lucide-react";

// Distintivo "Publicado" (AC 3.17, AC 3.26): el episodio tiene `publishedAt`
// y se ve en el showcase público (D10).
export function PublishedBadge() {
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1 rounded-full border border-primary/60 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground">
      <Globe aria-hidden="true" className="size-3" />
      Publicado
    </span>
  );
}
