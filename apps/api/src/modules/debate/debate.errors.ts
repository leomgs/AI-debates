// Excepción tipada (coding-rules.md §5) — no un Error genérico. Alcanzable
// en operación normal, no solo por bug de orquestación: un curador puede
// resolver un MAX_REVISIONS_EXCEEDED con la acción `reject` en vez de
// arreglar el draft, dejando a ese agente sin ningún Argument OFFICIAL para
// cuando arranca CROSS_EXAMINATION (ver frontend-notes.md, entrada
// 2026-09-08). Solo EpisodesModule la captura y decide la transición —
// mapea a CheckpointReason.VALIDATION_INCONSISTENCY (features.md Feature 4:
// "inconsistencia en validación intermedia que no rompe el backend pero
// requiere árbitro humano").
export class NoCrossExaminationTargetError extends Error {
  constructor(
    public readonly debateId: string,
    public readonly opponentAgentId: string
  ) {
    super(`El agente ${opponentAgentId} no tiene ningún Argument OFFICIAL en el debate ${debateId} para cross-examination.`);
    this.name = "NoCrossExaminationTargetError";
  }
}
