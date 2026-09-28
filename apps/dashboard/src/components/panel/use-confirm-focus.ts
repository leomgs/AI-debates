"use client";

import { useRef } from "react";

/**
 * Foco al cerrar un diálogo de confirmación (AC 3.77). Al cancelar, Radix
 * devuelve el foco al botón que lo abrió. Al confirmar, ese botón queda
 * deshabilitado mientras corre la acción (AC 3.49), o desaparece con el
 * estado nuevo, y el foco se perdería en el <body>: se lleva a `target`
 * (un encabezado o un bloque con tabIndex -1 cerca de lo que cambia).
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
      const element = target();
      if (element) {
        event.preventDefault();
        element.focus();
      }
    },
  };
}
