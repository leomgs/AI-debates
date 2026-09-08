# Frontend Notes — AI Trend Debates

Bitácora de casos de UX/negocio que van apareciendo mientras se construye el backend y que el proyecto de frontend (todavía no arrancado) va a necesitar contemplar. No es spec de producto (eso es `features.md` / `docs/product/`) ni contrato de API (`api-contract.md`) — es una lista de "esto hay que mostrarlo o manejarlo de alguna forma en la UI", para no perderlo entre sesiones de trabajo del backend.

Convención: cada entrada tiene fecha, de qué módulo/decisión del backend viene, y qué necesita resolver la UI.

## Entradas

### 2026-09-08 — `REQUIRES_HUMAN_REVIEW` por `VALIDATION_INCONSISTENCY`: falta target de cross-examination

Contexto (`tasks.md` sección 3, `DebateModule`, `pickCrossExaminationTarget`): si un agente llega a la ronda `CROSS_EXAMINATION` sin ningún `Argument` propio en estado `OFFICIAL`, el episodio pasa a `REQUIRES_HUMAN_REVIEW` con `reason: VALIDATION_INCONSISTENCY` (evento SSE `episode.requires_review`, `features.md` Feature 8). Ejemplo concreto de cómo se llega ahí: un curador usó la acción `reject` sobre un draft que agotó `max_revision_attempts` en una ronda anterior, en vez de arreglarlo — el agente queda sin ningún argumento OFFICIAL para esa ronda.

Qué necesita la UI:
- Distinguir este `reason` de los otros tres (`INSUFFICIENT_EVIDENCE`, `USAGE_LIMIT_EXCEEDED`, `MAX_REVISIONS_EXCEEDED`) con un mensaje propio: "a este agente le falta un argumento OFFICIAL para poder ser respondido en cross-examination".
- La resolución esperada es la acción `regenerate` (dispara que el agente afectado genere el argumento que le falta) — a diferencia de otros `VALIDATION_INCONSISTENCY`, acá no hay contenido previo que ofrecer para `edit`/`approve`, así que esas dos acciones no aplican en este caso puntual.
- Mostrar a qué agente le falta el argumento — viene en `EpisodeCheckpoint.debateRoundId` + `snapshot`.
