# Roadmap — AI Trend Debates

Documento de secuenciación. No repite el detalle de cada ítem (eso vive en `tasks.md`) — organiza y prioriza lo que `tasks.md` ya trackea, en el orden en que técnicamente conviene implementarlo, respetando las dependencias de `architecture.md` (sección 3, dirección de dependencias) y las prioridades P0/P1 de `features.md`. No agrega alcance nuevo: cada tarea referencia su ítem equivalente en `tasks.md`.

Última revisión: 2026-09-09.

## Objetivo

Llevar el backend desde su estado actual (schema, contratos y factory de modelos ya definidos, pero sin wiring de runtime ni módulos de dominio) hasta un pipeline de punta a punta que genere un debate verificado y auditado por un humano (MVP P0), y después sumar audio y render (P1) para completar el producto audiovisual.

## Próximo paso inmediato

**Fases 0, 1 y 2 completas** (última verificada contra APIs reales el 2026-09-08 — ver `tasks.md` §0-4/7 y `decision-log.md` entradas 1-18 para el detalle y el proceso de cada decisión no obvia). El backend ya corre el pipeline completo de punta a punta: `POST /episodes` → research → debate (OPENING/REBUTTAL/CROSS_EXAMINATION) con fact-check/enmienda → veredicto → `PENDING_REVIEW`, con SSE en vivo, notificaciones, resume/recovery y curaduría humana (`approve`/`edit`/`regenerate`/`reject`/`resume`) — todo verificado con `scripts/smoke-test-episode.ts` contra Tavily + Gemini reales, última corrida limpia (`PENDING_REVIEW`, 2 argumentos OFFICIAL, veredicto, cero claims fallidos).

**Falta para cerrar el MVP P0** (Fase 3, ver abajo): el módulo `TTS` — único ítem P0 sin terminar. Diseño decidido y **camino crítico (Local/Piper) ya implementado y verificado contra el motor real** (2026-09-09, `decision-log.md` entradas 19-22, `tasks.md` §5): un episodio completo llega a `READY_FOR_RENDER` con audio real sintetizado localmente. Faltan Google/OpenRouter como proveedores alternativos y la regeneración/URLs firmadas (AC 6.2/6.1). `Render` es P1, no bloquea.

Alternativa igual de razonable a seguir con TTS: retomar el scaffolding de frontend, pausado a propósito hasta tener esta superficie HTTP real — ya está disponible.

## Fase 0 — Fundaciones de runtime — COMPLETA

Objetivo: que el proceso arranque, valide su entorno y pueda tocar la base de datos. Nada de dominio se puede construir sin esto.

- [x] Crear `shared/prisma/prisma.service.ts` + `PrismaModule` global (`tasks.md` §0)
- [x] Wirear `AppModule`: `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` + `PrismaModule` + `AiModule` (`tasks.md` §0)
- [x] Verificar `.env.example` sincronizado con `env.schema.ts` (`tasks.md` §0)
- [x] Habilitar `ANTHROPIC`/`XAI` en `ModelProviderFactory` (`tasks.md` §0) — con `GOOGLE_API_KEY` como única env var requerida (decisión del usuario, ver `tasks.md` §0)

## Fase 1 — Módulos de dominio (aislados, testeables sin levantar el pipeline) — COMPLETA

Objetivo: construir las piezas que `EpisodesModule` orquesta. Por diseño (`architecture.md` §3) estos módulos no se conocen entre sí ni conocen a `Episode`. Los 4 módulos están completos, con tests unitarios y `tsc` limpio — detalle en `tasks.md` §1-4.

1. **Agents** (`tasks.md` §2) — `argue()`/`respond()`/`amend()`/`judge()`, seed de los 5 `Agent`, tests unitarios con LLM mockeado. Sumado después: identidad real de agentes en `DebateContext` y prompt anti-alucinación reforzado (`decision-log.md` entradas 16, 18).
2. **Research** (`tasks.md` §1) — Tavily como proveedor de búsqueda, `InsufficientEvidenceError`, extracción de `EvidenceFact`, verificado contra API real.
3. **Fact-check** (`tasks.md` §4) — claim extraction, fact-checking estricto con trazabilidad a `sourceIds`, filtro editorial. Sumado después: `editorialReview` recibe el argumento completo, no el claim aislado (entradas 11-12), y se fuerza siempre a `GOOGLE` (entrada 14).
4. **Debate** (`tasks.md` §3) — `DebateRound` tipado, promoción DRAFT→OFFICIAL, selección de `respondsToId`, `ArgumentHistory`, `Verdict`.

## Fase 2 — Episodes: el orquestador (entrega el MVP demoable) — COMPLETA

Objetivo: integrar Fase 1 en el pipeline completo `CREATED → RESEARCHING → READY_FOR_DEBATE → DEBATING → JUDGING → PENDING_REVIEW`, con control de costos y curaduría humana. Detalle completo en `tasks.md` §7.

- [x] `EpisodeStateService` — único escritor de `Episode.status`
- [x] Selección de participantes (2 de 4 personas + Judge con provider distinto + orden de turnos)
- [x] Loop de rondas OPENING → REBUTTAL → CROSS_EXAMINATION
- [x] `procesarBorrador` (claim extraction + fact-check/editorial + loop de enmienda) — ahora también rechaza claims `UNSUPPORTED`, no solo `FALSE`/`MISLEADING` (`decision-log.md` entrada 17)
- [x] Chequeo de presupuesto (`EpisodeUsage`) antes de cada llamada externa (AC 2.1) — `UPDATE` atómico tras corregir una condición de carrera real (entrada 15)
- [x] `EpisodeCheckpoint` como historial al entrar a `REQUIRES_HUMAN_REVIEW`
- [x] `Resume` + escalado a `FAILED` si se repite la causa
- [x] Idempotencia post-caída del proceso (`EpisodeRecoveryService`)
- [x] Controller: `POST /episodes`, `GET /episodes`, `GET /episodes/:id`, acciones `approve`/`edit`/`regenerate`/`reject`/`resume`, tabla de transiciones → `409 INVALID_STATE_TRANSITION`. `GET /episodes/:id/audio/:audioAssetId/url` y `GET /episodes/:id/manifest` quedan fuera a propósito (dependen de TTS/Render, Fase 3/4)
- [x] DTOs Zod separados de los contratos de agentes
- [x] Tests de integración multi-módulo, todo mockeado en el borde externo
- [x] Formato de error HTTP consistente `{ error: { code, message } }`
- [x] Seed de config default de `Episode` (vive como `@default` en `schema.prisma`, no requiere seed aparte)

Cerrada esta fase, el backend completa un episodio de punta a punta hasta `PENDING_REVIEW`/`APPROVED`, aunque sin audio ni video todavía — verificado contra APIs reales (Tavily + Gemini), no solo con mocks.

## Fase 3 — Real-time y cierre del MVP P0 (TTS)

Objetivo: completar lo que falta para que un episodio `APPROVED` pueda llegar a `READY_FOR_RENDER` (Feature 6 es P0). El real-time (Feature 8, también P0) ya está resuelto.

- [x] `GET /episodes/:id/events` (SSE) + los 6 eventos definidos (`tasks.md` §8) — COMPLETA
- [~] TTS: 3 `AudioProvider` seleccionables vía env var (`tasks.md` §5, `decision-log.md` entradas 19-22). **Local (`echogarden`+Piper) completo y verificado contra el motor real** — `AudioStorageProvider`/`LocalDiskStorageProvider`, migración `Agent.voiceId` a `Json`, wiring completo en `EpisodeBudgetService`/`EpisodeStateService`/`EpisodeOrchestratorService`/`EpisodeRecoveryService`, smoke test real (`npm run smoke:tts`) en verde. Faltan: Google (`google-tts-api`), OpenRouter (`fish-audio/s2.1-pro-free:free`, gateado por spike de validación), regeneración atómica de `sequenceIndex` (AC 6.2) y URLs firmadas (AC 6.1).
- [ ] Wirear la transición `GENERATING_AUDIO → READY_FOR_RENDER` en `EpisodeStateService`/orquestación (hoy el pipeline cubre hasta `PENDING_REVIEW`/`Resume`, falta el tramo post-aprobación que dispara TTS)
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

- **Estrategia de seed/fixtures de la Evidence Base para desarrollo local** (`tasks.md` §9) — research contra APIs reales tiene costo; hay que decidir si se graban fixtures de respuestas reales, se usa un proveedor de bajo costo en dev, o se mockea por completo mientras no se apunte a producción.
- **Proveedor de storage para `AudioAsset`** — `features.md` (AC 6.1) exige abstraer disco local / S3 / R2 / GCS pero no fija cuál usar en el MVP; conviene decidirlo antes de arrancar TTS (Fase 3) para no re-trabajar el `AudioProvider`.

**Resueltas**: proveedor de búsqueda web para Research → **Tavily** (`tasks.md` §1, decidido 2026-09-08).

## Referencias

- `tasks.md` — estado detallado ítem por ítem (fuente de verdad de qué está hecho).
- `architecture.md` — cómo se implementa cada pieza, algoritmo de orquestación (§7).
- `features.md` — qué hace cada feature, criterios de aceptación, prioridad P0/P1.
- `api-contract.md` — superficie HTTP completa.
- `coding-rules.md` — convenciones a respetar en cada tarea de este roadmap.
