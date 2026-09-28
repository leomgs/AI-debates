import { Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionErrorView } from "@/lib/episode-actions";
import { cn } from "@/lib/utils";

/**
 * Error de una acción, junto al control que la disparó. El texto sale de
 * actionErrorView (mensajes específicos de la spec o el error genérico con
 * el `error.message` del envelope; nunca un JSON crudo).
 */
export function ActionErrorMessage({
  view,
  id,
  className,
}: {
  view: ActionErrorView;
  id?: string;
  className?: string;
}) {
  return (
    <p
      id={id}
      role="alert"
      className={cn(
        "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className,
      )}
    >
      {view.message}
    </p>
  );
}

/**
 * Aviso arriba de la pantalla tras una acción que refrescó el detalle: el
 * 409 INVALID_STATE_TRANSITION (AC 3.48, AC 3.85) o el 404 de un argumento
 * que ya no está (AC 3.50). Va arriba porque, con el detalle nuevo, el
 * control que disparó la acción puede haber desaparecido. La región
 * `role="status"` está siempre montada, así el lector de pantalla anuncia el
 * aviso cuando aparece.
 */
export function ScreenNotice({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  return (
    <div role="status">
      {message !== null && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-primary/50 bg-primary/10 px-4 py-3 text-sm">
          <p className="flex items-start gap-2">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {message}
          </p>
          <Button variant="ghost" size="icon-xs" onClick={onDismiss} aria-label="Cerrar el aviso">
            <X aria-hidden="true" />
          </Button>
        </div>
      )}
    </div>
  );
}
