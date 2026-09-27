import { Ban, Circle, CircleCheck, CircleX, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { episodeStatusUi, type EpisodeStatus, type StatusCategory } from "@/lib/episode-status";

// Tratamiento visual por categoría (spec 003, "Mapeo de estados a UI"): solo
// tokens del tema de shadcn (D21), nunca colores fijos. La paleta es neutra,
// así que la categoría no depende solo del color: cada una lleva su ícono y
// la etiqueta siempre es texto.
const CATEGORY_STYLES: Readonly<Record<StatusCategory, { className: string; Icon: LucideIcon }>> = {
  neutral: { className: "border-border text-muted-foreground", Icon: Circle },
  "in-progress": { className: "border-transparent bg-secondary text-secondary-foreground", Icon: LoaderCircle },
  attention: { className: "border-transparent bg-primary text-primary-foreground", Icon: TriangleAlert },
  ready: { className: "border-primary/60 text-foreground", Icon: CircleCheck },
  cancelled: { className: "border-border text-muted-foreground line-through decoration-muted-foreground/60", Icon: Ban },
  error: { className: "border-destructive/50 bg-destructive/15 text-destructive", Icon: CircleX },
};

/** Etiqueta de estado con su categoría visual (AC 3.11, AC 3.17). */
export function StatusBadge({ status, className }: { status: EpisodeStatus; className?: string }) {
  const { label, category } = episodeStatusUi(status);
  const { className: categoryClassName, Icon } = CATEGORY_STYLES[category];
  return (
    <span
      data-category={category}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        categoryClassName,
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
    </span>
  );
}
