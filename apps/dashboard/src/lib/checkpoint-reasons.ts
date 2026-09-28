import type { components } from "@/lib/api/schema";

// Motivos de interrupción (CheckpointReason) en español (spec 003, sección
// 7; AC 3.31, AC 3.40). El texto resume "Qué explica la UI" de la tabla de
// AC 3.51; el panel de resolución de cada motivo (F2-C) da el detalle. El
// tipo sale de openapi.json (D5): un motivo nuevo en la API hace fallar el
// build hasta que tenga su texto.
export type CheckpointReason = components["schemas"]["EpisodeDetailDto_Output"]["checkpoints"][number]["reason"];

export const CHECKPOINT_REASON_LABELS: Readonly<Record<CheckpointReason, string>> = {
  USAGE_LIMIT_EXCEEDED: "Se agotó el presupuesto del episodio",
  INSUFFICIENT_EVIDENCE: "La investigación encontró menos de 3 fuentes válidas",
  MAX_REVISIONS_EXCEEDED: "Un agente agotó sus intentos de revisión en el fact-checking",
  VALIDATION_INCONSISTENCY: "Un agente llegó al contrainterrogatorio sin un argumento propio al que responder",
  PROVIDER_QUOTA_EXCEEDED: "Se agotó la cuota del proveedor externo o el servicio de audio no está disponible",
  VOICE_NOT_CONFIGURED: "Faltan voces de audio configuradas para el idioma del episodio",
};

/**
 * Texto de un motivo. Un valor que la API todavía no documenta (AC 3.55) no
 * rompe la pantalla: se muestra el código crudo.
 */
export function checkpointReasonLabel(reason: string): string {
  return Object.hasOwn(CHECKPOINT_REASON_LABELS, reason)
    ? CHECKPOINT_REASON_LABELS[reason as CheckpointReason]
    : `Motivo desconocido (${reason})`;
}
