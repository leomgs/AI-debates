# Roadmap — AI Trend Debates

Documento de secuenciación. No repite el detalle de cada ítem (eso vive en `tasks.md`) — organiza y prioriza lo que `tasks.md` ya trackea, en el orden en que técnicamente conviene implementarlo, respetando las dependencias de `architecture.md` (sección 3, dirección de dependencias) y las prioridades P0/P1 de `features.md`. No agrega alcance nuevo: cada tarea referencia su ítem equivalente en `tasks.md`.

Última revisión: 2026-09-07.

## Objetivo

Llevar el backend desde su estado actual (schema, contratos y factory de modelos ya definidos, pero sin wiring de runtime ni módulos de dominio) hasta un pipeline de punta a punta que genere un debate verificado y auditado por un humano (MVP P0), y después sumar audio y render (P1) para completar el producto audiovisual.

## Próximo paso inmediato

**Fase 0 completa** (2026-09-07) — ver `tasks.md` §0 para el detalle de lo hecho, incluyendo dos hallazgos no anticipados: Prisma 7 exige un driver adapter explícito incluso para SQLite, y `@nestjs/config@12` es ESM-only (rompía los tests hasta ajustar `transformIgnorePatterns`). El próximo paso es arrancar **Fase 1**, empezando por **Agents** (ver abajo).

## Fase 0 — Fundaciones de runtime — COMPLETA

Objetivo: que el proceso arranque, valide su entorno y pueda tocar la base de datos. Nada de dominio se puede construir sin esto.

- [x] Crear `shared/prisma/prisma.service.ts` + `PrismaModule` global (`tasks.md` §0)
- [x] Wirear `AppModule`: `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` + `PrismaModule` + `AiModule` (`tasks.md` §0)
- [x] Verificar `.env.example` sincronizado con `env.schema.ts` (`tasks.md` §0)
- [x] Habilitar `ANTHROPIC`/`XAI` en `ModelProviderFactory` (`tasks.md` §0) — con `GOOGLE_API_KEY` como única env var requerida (decisión del usuario, ver `tasks.md` §0)

## Fase 1 — Módulos de dominio (aislados, testeables sin levantar el pipeline)

Objetivo: construir las piezas que `EpisodesModule` va a orquestar más adelante. Por diseño (`architecture.md` §3) estos módulos no se conocen entre sí ni conocen a `Episode`, así que en principio son paralelizables. Orden sugerido cuando hay que elegir por dónde arrancar:

1. **Agents** (`tasks.md` §2) — desbloquea el seed de los 5 `Agent` (4 debatientes + Judge), del cual dependen luego `EpisodeParticipant` y cualquier fixture de Debate/Episodes.
   - [ ] Módulo (`agents.module.ts`/`.service.ts`, sin controller)
   - [ ] `argue()`, `respond()`, `amend()` sobre `DebateAgent`
   - [ ] Wiring de `buildDebaterSystemPrompt`/`buildJudgeSystemPrompt`
   - [ ] Política Cockatiel (`.parse()` de Zod dentro del retry)
   - [ ] Seed de los 5 `Agent`
   - [ ] Tests unitarios con LLM mockeado
2. **Research** (`tasks.md` §1) — evidence base, independiente del resto.
   - [ ] Módulo + proveedor de búsqueda web + política Cockatiel
   - [ ] Persistencia de `Source` con trazabilidad (`fetchTimestamp`/`publishedAt`/`contentHash`)
   - [ ] `InsufficientEvidenceError`
   - [ ] Extracción de `EvidenceFact` (`ResearchOutputSchema`)
   - [ ] Tests unitarios
3. **Fact-check** (`tasks.md` §4) — depende conceptualmente de que existan claims/evidence a verificar, pero se puede construir y testear con evidencia mockeada sin esperar a que Research esté terminado.
   - [ ] Módulo + claim extraction + fact-checking estricto + filtro editorial
   - [ ] Paralelización agrupada por `ModelProvider`
   - [ ] Excepción `MAX_REVISIONS_EXCEEDED`
   - [ ] Tests unitarios
4. **Debate** (`tasks.md` §3) — capa de persistencia de rondas/argumentos/veredicto; el módulo más ligado a lo que `Episodes` va a necesitar directamente.
   - [ ] Módulo + `DebateRound` tipado + promoción DRAFT→OFFICIAL
   - [ ] Selección aleatoria de `respondsToId` en CROSS_EXAMINATION
   - [ ] `ArgumentHistory` (`Origin: Human_Edited`)
   - [ ] Persistencia de `Verdict`
   - [ ] Tests unitarios

Nota: si se prefiere paralelizar entre varias personas/sesiones, estos 4 módulos son la unidad de paralelización natural del proyecto — no hay imports cruzados entre ellos.

## Fase 2 — Episodes: el orquestador (entrega el MVP demoable)

Objetivo: integrar Fase 1 en el pipeline completo `CREATED → RESEARCHING → READY_FOR_DEBATE → DEBATING → JUDGING → PENDING_REVIEW`, con control de costos y curaduría humana. Esta es la fase de mayor riesgo/complejidad (algoritmo ya resuelto en `architecture.md` §7) y la que hace demostrable el producto por primera vez.

- [ ] `EpisodeStateService` — único escritor de `Episode.status` (`tasks.md` §7)
- [ ] Selección de participantes (2 de 4 personas + Judge con provider distinto + orden de turnos)
- [ ] Loop de rondas OPENING → REBUTTAL → CROSS_EXAMINATION
- [ ] `procesarBorrador` (claim extraction + fact-check/editorial + loop de enmienda)
- [ ] Chequeo de presupuesto (`EpisodeUsage`) antes de cada llamada externa (AC 2.1)
- [ ] `EpisodeCheckpoint` como historial al entrar a `REQUIRES_HUMAN_REVIEW`
- [ ] `Resume` + escalado a `FAILED` si se repite la causa
- [ ] Idempotencia post-caída del proceso
- [ ] Controller: `POST /episodes`, `GET /episodes`, `GET /episodes/:id`, `GET /episodes/:id/audio/:audioAssetId/url`, acciones `approve`/`edit`/`regenerate`/`reject`/`resume`, tabla de transiciones → `409 INVALID_STATE_TRANSITION`
- [ ] DTOs Zod separados de los contratos de agentes
- [ ] Tests de integración (los únicos del proyecto, todo mockeado en el borde externo)
- [ ] Formato de error HTTP consistente `{ error: { code, message } }` (`tasks.md` §9) — recién aplica ahora que existe el primer controller real
- [ ] Seed de config default de `Episode` (`tasks.md` §9)

Al cerrar esta fase, el backend puede completar un episodio de punta a punta hasta `PENDING_REVIEW`/`APPROVED`, aunque sin audio ni video todavía — ya es un flujo curable por un humano vía API.

## Fase 3 — Real-time y cierre del MVP P0 (TTS)

Objetivo: completar lo que falta para que un episodio `APPROVED` pueda llegar a `READY_FOR_RENDER` (Feature 6 es P0), y dar visibilidad en vivo del progreso (Feature 8, también P0). Depende de que Fase 2 ya emita puntos de enganche (inicio de research, turnos de agentes, fact-checks, aprobación de argumentos, entrada a revisión).

- [ ] `GET /episodes/:id/events` (SSE) + los 6 eventos definidos (`tasks.md` §8)
- [ ] TTS: módulo, `AudioProvider` (google-tts-api inicial), generación de `AudioAsset` por segmento, presigned URLs (AC 6.1), regeneración atómica de un `sequenceIndex` (AC 6.2), Cockatiel (`tasks.md` §5)
- [ ] Wirear la transición `GENERATING_AUDIO → READY_FOR_RENDER` en `EpisodeStateService`/orquestación (gap no listado explícitamente en `tasks.md` §7 pero necesario: hoy el checklist de Episodes cubre hasta `PENDING_REVIEW`/`Resume`, falta el tramo post-aprobación que dispara TTS)
- [ ] `README.md` real (`tasks.md` §9)
- [ ] `04-development/testing-strategy.md` (`tasks.md` §9) — ya hay módulos implementados para documentar el patrón real usado

Al cerrar esta fase, todo lo marcado P0 en `features.md` está cubierto de punta a punta.

## Fase 4 — P1: Render y preview

Objetivo: producir el `.mp4` final. No bloquea el MVP core (`features.md` marca Feature 9 como P1; `tasks.md` §6 lo confirma).

- [ ] Módulo Render: generación de `RemotionManifest` (contrato de Feature 7)
- [ ] Worker desacoplado que ejecuta el binario de Remotion
- [ ] `GET /episodes/:id/manifest` con URLs firmadas resueltas
- [ ] Wirear transición `RENDERING → COMPLETED`

## Decisiones abiertas (el usuario debe resolverlas, no se infieren)

- **Proveedor de búsqueda web para Research** (`tasks.md` §1) — no está decidido/contratado. Bloquea el arranque real de la Fase 1.1 (Research); se puede empezar el módulo con la integración mockeada, pero la elección de proveedor (y su costo/rate limits) condiciona la política Cockatiel y las credenciales en `.env.schema.ts`.
- **Estrategia de seed/fixtures de la Evidence Base para desarrollo local** (`tasks.md` §9) — research contra APIs reales tiene costo; hay que decidir si se graban fixtures de respuestas reales, se usa un proveedor de bajo costo en dev, o se mockea por completo mientras no se apunte a producción.
- **Proveedor de storage para `AudioAsset`** — `features.md` (AC 6.1) exige abstraer disco local / S3 / R2 / GCS pero no fija cuál usar en el MVP; conviene decidirlo antes de la Fase 3 para no re-trabajar el `AudioProvider`.

## Referencias

- `tasks.md` — estado detallado ítem por ítem (fuente de verdad de qué está hecho).
- `architecture.md` — cómo se implementa cada pieza, algoritmo de orquestación (§7).
- `features.md` — qué hace cada feature, criterios de aceptación, prioridad P0/P1.
- `api-contract.md` — superficie HTTP completa.
- `coding-rules.md` — convenciones a respetar en cada tarea de este roadmap.
