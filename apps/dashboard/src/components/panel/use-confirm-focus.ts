"use client";

import { useRef } from "react";

/**
 * Foco al cerrar un diálogo de confirmación (AC 3.77). Al cancelar, Radix
 * devuelve el foco al botón que lo abrió. Al confirmar, ese botón queda
 * deshabilitado mientras corre la acción (AC 3.49) y el foco se perdería en
 * el <body>, así que se lleva a `target`: el encabezado del panel o el
 * bloque que muestra el progreso.
 *
 * Es solo el destino mientras la acción corre. Si al terminar el episodio
 * sale del estado (aprobar, rechazar, reanudar, o un 409 o 404 que refresca
 * el detalle), el panel y `target` se desmontan, y el foco final lo pone
 * useEpisodeActions en algo que sobrevive al cambio: el `<h1>` de la
 * cabecera o el aviso de pantalla. Por eso, tras confirmar, Radix nunca
 * vuelve al botón: si `target` ya no está, no se toca el foco y queda el de
 * useEpisodeActions. Lo mismo si la acción terminó durante la animación de
 * cierre y useEpisodeActions ya movió el foco fuera del diálogo: no se pisa.
 */
export function useConfirmFocus(target: () => HTMLElement | null) {
  const confirmed = useRef(false);
  return {
    /** Llamar en el onClick del botón que confirma. */
    markConfirmed() {
      confirmed.current = true;
    },
    /** Para `onCloseAutoFocus` de AlertDialogContent. */
    onCloseAutoFocus(event: Event) {
      if (!confirmed.current) return;
      confirmed.current = false;
      event.preventDefault();
      const active = document.activeElement;
      const movedOut =
        active instanceof HTMLElement &&
        active !== document.body &&
        active.closest('[role="alertdialog"]') === null;
      if (movedOut) return;
      const element = target();
      if (element?.isConnected) element.focus();
    },
  };
}
