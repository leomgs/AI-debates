// Excepción tipada (coding-rules.md §5) — no un null/undefined silencioso.
// Solo EpisodesModule la captura y decide la transición a
// REQUIRES_HUMAN_REVIEW con reason: INSUFFICIENT_EVIDENCE (features.md
// Feature 1, edge case: <3 fuentes válidas con hash de contenido distinto).
export class InsufficientEvidenceError extends Error {
  constructor(foundCount: number) {
    super(`Se encontraron ${foundCount} fuente(s) válida(s), se requieren al menos 3.`);
    this.name = "InsufficientEvidenceError";
  }
}
