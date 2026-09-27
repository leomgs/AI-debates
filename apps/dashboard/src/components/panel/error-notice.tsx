import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";

// "Error genérico" de la spec 003: mensaje legible con el `error.message` del
// envelope y la opción de reintentar; nunca un JSON crudo ni una pantalla en
// blanco (AC 3.73).
export function ErrorNotice({
  title,
  error,
  onRetry,
  retrying = false,
  className,
}: {
  title: string;
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm",
        className,
      )}
    >
      <div className="space-y-1">
        <p className="font-medium text-destructive">{title}</p>
        <p className="text-muted-foreground">{errorMessage(error)}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
        <RotateCw aria-hidden="true" className={cn(retrying && "animate-spin")} />
        {retrying ? "Reintentando…" : "Reintentar"}
      </Button>
    </div>
  );
}
