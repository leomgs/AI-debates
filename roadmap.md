# Roadmap — AI Trend Debates

Documento de secuenciación. No repite el detalle de cada ítem (eso vive en `tasks.md`) — organiza y prioriza lo que `tasks.md` ya trackea, en el orden en que técnicamente conviene implementarlo, respetando las dependencias de `architecture.md` (sección 3, dirección de dependencias) y las prioridades P0/P1 de `features.md`. No agrega alcance nuevo: cada tarea referencia su ítem equivalente en `tasks.md`.

Última revisión: 2026-09-27, octava pasada (spec 004 ajustada por D20: las voces `EN`/`PT` pasan a la mejora posterior "Voces EN/PT", nueva 7.4; el paso 1 sale de la ruta crítica de la F2, que queda en pasos 4 → 6 → 7; `tasks.md` §13.11). Séptima pasada, 2026-09-26 (F1 del dashboard mergeada a `master`; 6.1 completa, con los dos ítems de Workspace hechos en la rama de F1; estado de la ruta crítica de la F2 actualizado). Sexta pasada, mismo día (checkboxes sincronizados con el bloque F2-2: API-10b, API-14, API-15 y API-19; `decision-log.md` entrada 35). Quinta pasada, 2026-09-25 (checkboxes sincronizados con lo implementado: API-8, API-1 parte 1, API-5, API-7a, API-12, API-13 y los pasos 3 y 5a de la Fase 7; `decision-log.md` entradas 33-34). Cuarta pasada (spec 003 sin preguntas abiertas: D17-D20, AC 3.81-3.86 y API-19 `regenerate-verdict`, bloqueante de F2; `/docs` solo fuera de producción dentro de API-8). Tercera pasada del mismo día: preguntas A y B de la spec 004 resueltas (la Fase 7 ya no tiene pasos bloqueados) y pregunta 7 de la spec 003 cerrada con D16 (showcase bajo `/[locale]`, solo front). Segunda pasada: spec 004 escrita y revisada por `architect`, ADR 0002 aceptado; spec 003 ajustada (API-7a, API-17, API-18, AC 3.78/3.79, 6 motivos de `REQUIRES_HUMAN_REVIEW`); nueva Fase 7 intercalada con la Fase 6 (ver "Orden crítico"). Revisión previa: 2026-09-25 (spec 003 escrita y revisada por `architect`, ADR 0001 aceptado; nueva Fase 6). Antes: 2026-09-24 (Feature 7 completa — MVP P0 cerrado; Fase 5 completa — specs 001 y 002 implementadas, ver `decision-log.md` entradas 28-30).

## Objetivo

Llevar el backend desde su estado actual (schema, contratos y factory de modelos ya definidos, pero sin wiring de runtime ni módulos de dominio) hasta un pipeline de punta a punta que genere un debate verificado y auditado por un humano (MVP P0), y después sumar audio y render (P1) para completar el producto audiovisual.

## Próximo paso inmediato

**MVP P0 completo (2026-09-24, `decision-log.md` entrada 27)**: con Feature 7 (Remotion Manifest) implementada y verificada contra el servidor y el motor reales, **todo lo marcado P0 en `features.md` queda cubierto de punta a punta**: `POST /episodes` → research → debate (OPENING/REBUTTAL/CROSS_EXAMINATION) con fact-check/enmienda → veredicto → `PENDING_REVIEW` → curaduría humana → TTS (URLs firmadas + regeneración atómica) → `GET /episodes/:id/manifest` con subtítulos reales y audio firmado, listo para que un worker de Remotion lo consuma. Ver `tasks.md` §0-4/6/7 y `decision-log.md` entradas 1-27 para el detalle y el proceso de cada decisión no obvia.

**Próximo paso real**: no queda ningún ítem P0 pendiente, y la Fase 5 completa (specs 001 y 002, `decision-log.md` #29-30) — el repo ya es un monorepo `pnpm`+Turborepo real (`apps/api`+`packages/contracts`+`packages/video`+`apps/dashboard`), con `packages/video` verificado con un render real. Lo que sigue:
- **Spec 003 (UI real del dashboard) — escrita, revisada por `architect` y sin preguntas abiertas (2026-09-25)**: `docs/product/003-dashboard-ui.md`, con la topología de auth en `docs/adr/0001-auth-sesion-nest-mismo-origen.md` (aceptado). Panel de curación privado bajo `/studio` + showcase público de episodios publicados. El tracking del front vive en `apps/dashboard/docs/roadmap.md` (fases F1-F4); **las dependencias de backend que pide la spec (API-1..API-19, auth, showcase, refactor de `packages/video`) son la Fase 6 de este roadmap** (`tasks.md` §12). **La F1 del front (auth, origen único, cliente tipado, layouts) está implementada y mergeada en `master` (2026-09-26)**, y verificada en navegador por el usuario (2026-09-27): **F1 completa** (`apps/dashboard/docs/roadmap.md`, Fase 1). Lo que sigue del front es la F2, bloqueada por API-17 (Fase 7, pasos 4, 6 y 7), con API-10 recomendada antes; una parte de la F2 se puede adelantar ya (`apps/dashboard/docs/roadmap.md`, Fase 2, "Qué se puede adelantar antes de API-17").
- **Spec 004 (idioma del debate ES/EN/PT) — escrita y revisada por `architect`, con sus preguntas abiertas resueltas (2026-09-25)**: `docs/product/004-debate-language.md`, con el modelo de voces en `docs/adr/0002-voces-por-agente-e-idioma.md` (aceptado). Es la **Fase 7** de este roadmap (`tasks.md` §13). **Entrega API-17, que es bloqueante de la F2 del dashboard**, así que está en la ruta crítica de la spec 003 aunque tenga número de fase posterior. **Ajustada el 2026-09-27 (D20, decisión del usuario, revisada por `architect`)**: las voces `EN`/`PT` salen del MVP y pasan a la mejora posterior "Voces EN/PT" (7.4, `tasks.md` §13.11); en el MVP, crear un episodio `EN` o `PT` responde `409 VOICE_NOT_CONFIGURED` (AC 4.29). API-17 se sigue entregando con el MVP.
- **Feature 9 (Fase 4 más arriba)** — worker que ejecuta Remotion sobre el manifest y produce el `.mp4`. Ya no depende de nada nuevo: `packages/video` existe y sabe renderizar.
- **Backlog de TTS** (`tasks.md` §5) — Google/OpenRouter como proveedores adicionales, Chatterbox (motor GPU) para mejorar la calidad de voz de Piper. Ojo: con la spec 004, mientras no exista un segundo `AudioProvider` enlazado el backend no arranca con `TTS_PROVIDER` distinto de `LOCAL` (D16, ADR 0002 punto 5); implementar cualquiera de estos proveedores tiene que levantar esa restricción y cargar sus voces en `AgentVoice`. Es también lo que habilita pasar las voces `ES` a `es_MX`/latinoamericanas (spec 004, D5 y pregunta A).
- **Housekeeping menor** (`tasks.md` §9) — `04-development/testing-strategy.md`, estrategia de fixtures de Research para dev.

De estos, **la spec 003 es la continuación más directa** si el objetivo es tener una interfaz usable, y la spec 004 va dentro de su ruta crítica. La ruta crítica de la F2 ya no tiene decisiones del usuario en el medio. Orden concreto (detalle en "Orden crítico entre la Fase 6 y la Fase 7"):
1. **Ya, sin esperar nada**: API-8 (auth, bloqueante de F1, incluye `/docs` solo fuera de producción). En paralelo: API-5, API-12, API-13, API-1 (sin `language`) + API-7a, API-10b, y de la 004 los pasos 3 (contratos) y 5a (`EpisodeContextService`, sin cambio de comportamiento; también es prerrequisito de API-19). **Estado (2026-09-27)**: todo hecho. El paso 1 de la 004 (voces) ya no tiene pendientes para el MVP: por D20, elegir las voces `EN` y fijar la asignación `PT` pasó a la mejora posterior "Voces EN/PT".
2. **Después, en serie**: API-19 (`regenerate-verdict`, sobre API-10b y el paso 5a) y los pasos 4 (migración), 6 (TTS) y 7 (API) de la Fase 7, que cierran API-17 y el `language` de API-1, con las migraciones de a una (API-7a → `VerdictHistory` → la de la 004). Los pasos 5b, 5c, 8 y 9 cierran la spec 004 pero no bloquean la F2. **Estado (2026-09-27)**: API-19 hecha; faltan los pasos 4, 6 y 7, en ese orden. El paso 4 es el próximo y ya no espera ninguna elección de voces.

Feature 9 puede avanzar en paralelo, ya desbloqueada.

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
- [x] Controller: `POST /episodes`, `GET /episodes`, `GET /episodes/:id`, acciones `approve`/`edit`/`regenerate`/`reject`/`resume`, tabla de transiciones → `409 INVALID_STATE_TRANSITION`. `GET /episodes/:id/manifest` queda fuera a propósito (depende de Render, P1, Fase 4) — `GET /episodes/:id/audio/:audioAssetId/url` y la acción `regenerate-audio` se agregaron en la Fase 3 (TTS Etapa 3)
- [x] DTOs Zod separados de los contratos de agentes
- [x] Tests de integración multi-módulo, todo mockeado en el borde externo
- [x] Formato de error HTTP consistente `{ error: { code, message } }`
- [x] Seed de config default de `Episode` (vive como `@default` en `schema.prisma`, no requiere seed aparte)

Cerrada esta fase, el backend completa un episodio de punta a punta hasta `PENDING_REVIEW`/`APPROVED`, aunque sin audio ni video todavía — verificado contra APIs reales (Tavily + Gemini), no solo con mocks.

## Fase 3 — Real-time y TTS (Features 6 y 8) — COMPLETA

Objetivo: completar lo que falta para que un episodio `APPROVED` pueda llegar a `READY_FOR_RENDER` (Feature 6 es P0). El real-time (Feature 8, también P0) ya está resuelto. **No cierra el MVP P0 por sí sola** — Feature 7 (Fase 4) también es P0, ver corrección de prioridades arriba.

- [x] `GET /episodes/:id/events` (SSE) + los 6 eventos definidos (`tasks.md` §8) — COMPLETA
- [x] TTS: `AudioProvider` seleccionables vía env var (`tasks.md` §5, `decision-log.md` entradas 19-25). **Local (`echogarden`+Piper) completo y verificado contra el motor real** — `AudioStorageProvider`/`LocalDiskStorageProvider`, migración `Agent.voiceId` a `Json`, wiring completo en `EpisodeBudgetService`/`EpisodeStateService`/`EpisodeOrchestratorService`/`EpisodeRecoveryService`, smoke test real (`npm run smoke:tts`) en verde. **AC 6.1 (URLs firmadas) y AC 6.2 (regeneración atómica de `sequenceIndex`) completos y verificados contra el servidor real** (decision-log #25) — `GET /episodes/:id/audio/:audioAssetId/url` + `POST /episodes/:id/actions/regenerate-audio`. En backlog, no P0: Google (`google-tts-api`), OpenRouter (`fish-audio/s2.1-pro-free:free`, gateado por spike de validación), y un 4to proveedor GPU (`CHATTERBOX`, plan aprobado en decision-log #23, aislado a backlog en la entrada 24 — bloqueado por infraestructura local, Docker Desktop, ver `tasks.md` §5 "Backlog / mejoras futuras"). Nota: el `Json` de `Agent.voiceId` queda reemplazado por la tabla `AgentVoice` en la Fase 7 (ADR 0002).
- [x] Transición `GENERATING_AUDIO → READY_FOR_RENDER` wireada en `EpisodeStateService`/orquestación (etapa 2 de TTS, decision-log #22)
- [ ] `README.md` real (`tasks.md` §9) — housekeeping menor, no bloquea el MVP P0
- [ ] `04-development/testing-strategy.md` (`tasks.md` §9) — ya hay módulos implementados para documentar el patrón real usado

## Fase 4 — Render: Manifest (P0) + Rendering (P1)

Objetivo: `RenderModule` cubre dos features con prioridad distinta (`features.md`, corrección 2026-09-14 — `decision-log.md` entrada 26). No tratar el módulo como un bloque único: la mitad P0 cierra el MVP, la mitad P1 no bloquea nada.

**Feature 7 — Remotion Manifest (P0) — COMPLETA (2026-09-24, `decision-log.md` entrada 27)**: con esto, el MVP P0 quedó cerrado.
- [x] Generación de `RemotionManifest` (`RenderService.buildManifest()`, puro — `episodeId`, `meta`, `agents`, `timeline`, `verdict`), a partir de `officialArguments`/`AudioAsset`/`Verdict` ya resueltos por `EpisodesService.getManifest()`
- [x] `subtitles` por segmento (timing por palabra) — gap cerrado. `EchogardenAudioProvider.synthesize()` extrae el timing real (jerárquico, en segundos) del `timeline` que `echogarden` devuelve, vía `extractWordSubtitles()`. Persistido en `AudioAsset.subtitles Json?` nuevo (migración `20260924105615_audio_asset_subtitles`)
- [x] `GET /episodes/:id/manifest` con URLs firmadas resueltas — reusa `TtsService.getSignedAudioUrl` (AC 6.1), agregado como `audioUrl` en cada `timeline[]` entry
- [x] Decidido: el manifest se genera **al vuelo en cada `GET`** (no se persiste en `Episode.remotionManifest`) — las URLs firmadas tienen TTL corto, cachear el manifest completo las dejaría vencidas

**Feature 9 — Video Rendering & Preview (P1)**: no bloquea el MVP core. Es la continuación natural del trabajo ya hecho (el manifest que este worker necesita ya existe y está verificado).
- [ ] Worker desacoplado que ejecuta el binario de Remotion
- [ ] Persistencia en `Asset` del `.mp4` resultante
- [ ] Wirear transición `RENDERING → COMPLETED`
- [ ] Frontend: consumo del manifest vía `@remotion/player` — **cubierto por la spec 003** (D2, F3/F4 del dashboard; no espera a este worker)

**Con Feature 7 cerrada, todo lo marcado P0 en `features.md` queda cubierto de punta a punta.**

## Fase 5 — Post-MVP: contrato de API y monorepo — COMPLETA

Objetivo: preparar el terreno para que exista un frontend. `features.md` sigue congelado v1.0 (Features 1-10) — esto fue trabajo nuevo, fuera de ese contrato, especificado en `docs/product/`. Detalle completo, decisiones y hallazgos reales en `decision-log.md` entradas 28 (revisión), 29 (implementación de la 001) y 30 (implementación de la 002).

- [x] **`docs/product/001-openapi-contract-zod.md`** — COMPLETA (2026-09-24). `openapi.json` generado desde los contratos Zod ya existentes (`@nestjs/swagger` + `nestjs-zod`), `/docs` navegable. `RemotionManifest`/`EpisodeDetailResponse` migrados a schemas Zod, 6 schemas de eventos SSE (Feature 8) escritos contra los payloads reales. Verificado contra el servidor real. Detalle en `tasks.md` §10.
- [x] **`docs/product/002-workspace-restructure.md`** — COMPLETA (2026-09-24). Monorepo `pnpm` + Turborepo real: `apps/api` (este backend, movido intacto — `dev.db`/`outputs/` preservados), `packages/contracts` (`RemotionManifest` compartido), `packages/video` (Remotion desde cero, **verificado con un render real** contra el fixture, sin DB ni `.env`), `apps/dashboard` (scaffold Next.js vacío). Bloqueante real encontrado en el camino: `better-sqlite3@13.x` no publica binarios precompilados, bajado a `^12.11.1`. Detalle en `tasks.md` §11.

El tracking del dashboard en sí (framework, UI, autenticación) **no vive acá** — es `apps/dashboard/docs/roadmap.md`. La UI real del dashboard ya tiene su spec escrita (`docs/product/003-dashboard-ui.md`); lo que esa spec le pide al backend es la Fase 6, más la Fase 7 (spec 004), que entrega API-17.

## Fase 6 — Dependencias de backend de la spec 003 (dashboard)

Objetivo: dejar la API y el workspace en condiciones de que el dashboard (`apps/dashboard/docs/roadmap.md`, fases F1-F4) cumpla la spec `docs/product/003-dashboard-ui.md` sin duplicar tipos ni lógica de backend (D3, D5). Post-MVP, fuera de `features.md` (congelado). Cada ítem cita su API-n de la spec ("Cambios requeridos en la API") y los AC que desbloquea; la topología de auth es la del ADR 0001. Detalle ítem por ítem en `tasks.md` §12.

Ordenado por la fase del front que desbloquea. "Bloqueante"/"no bloqueante" es la clasificación de la propia spec. **Se implementa intercalada con la Fase 7** (spec 004): ver "Orden crítico entre la Fase 6 y la Fase 7" al final de la Fase 7.

**6.1 — Antes de F1 (base del dashboard)** — COMPLETA. La F1 del front quedó mergeada en `master` el 2026-09-26 (`apps/dashboard/docs/roadmap.md`, Fase 1).
- [x] **API-8 — Módulo auth (ADR 0001)** — bloqueante (AC 3.1-3.9). **Hecho 2026-09-25** (`decision-log.md` entrada 33). `modules/auth` (`POST /auth/login`, `POST /auth/logout`, `GET /auth/session`), `SessionGuard` global que niega por defecto, `@Public()`, credenciales en `.env` sin defaults, rate-limit en login, `trust proxy`, `401` documentado en OpenAPI, sin `enableCors()`, `AUDIO_SIGNING_SECRET` obligatorio en producción, y Swagger (`/docs`) montado solo fuera de producción (D20). Es el primer paso de toda la spec: sin él la F1 no puede cumplir su criterio.
- [x] **Workspace: `check-boundaries` extendido a `apps/dashboard`** (spec, "Límites del workspace"; F1) — prohíbe `@ai-trend-debates/api` e imports relativos fuera del paquete, detecta `import()` dinámico e `import "x"`, corre en CI o `prebuild`. **Hecho 2026-09-26** en la rama de F1, ya mergeada: corre como tarea raíz de Turborepo antes de todo `build` (`tasks.md` §12.1).
- [x] **Workspace: `dev.dependsOn: ["^build"]` en el `turbo.json` raíz** (spec, "Turborepo y tipos"). **Hecho 2026-09-26** en la rama de F1, ya mergeada.

**6.2 — Antes de F2 (panel de curación)** — recomendados en paralelo con F1 (spec, plan F1)
- [~] **API-1** — bloqueante (AC 3.17 idioma, 3.26-3.29, 3.32, 3.51). **Parte 1 hecha 2026-09-25** (tópico, `createdAt` y participantes; `decision-log.md` entrada 34); falta `language` (Fase 7, paso 7): tópico, `createdAt`, `language` y participantes en `getEpisodeDetail`; `language` en `listEpisodes`. Cierra también API-9. **Se entrega en dos partes**: tópico/`createdAt`/participantes ya (no depende de nada); `language` en detalle y listado lo entrega la Fase 7, paso 7 (spec 004, AC 4.18), porque la columna `Episode.language` nace en su migración.
- [x] **API-7a** — bloqueante (AC 3.17, 3.26, distintivo "Publicado"). **Hecho 2026-09-25** (migración `20260925120000_add_episode_published_at`; entrada 34): columna `Episode.publishedAt` (nullable, `null` hasta que exista `publish`) + exposición en `getEpisodeDetail` y `listEpisodes`. Separada de API-7 para construir el distintivo en F2 (D10, decisión del usuario). Migración chica, sin dependencias: es la primera de la cola de migraciones (ver "Orden crítico").
- [x] **API-17** (HECHO 2026-09-27, pasos 4, 6 y 7 de la Fase 7) — bloqueante (AC 3.22, 3.51 fila `VOICE_NOT_CONFIGURED`, 3.67, 3.78): **lo entrega la Fase 7 (spec 004)**, no se implementa acá. `language` en `createEpisode` (default `ES`), `409 VOICE_NOT_CONFIGURED`, `CheckpointReason.VOICE_NOT_CONFIGURED` reanudable con `{}`, `meta.language` en el manifest, todo en `openapi.json`. Se da por cumplido cuando cierran los pasos 3, 4, 6 y 7 de la Fase 7. No depende de la mejora "Voces EN/PT" (7.4, D20): en el MVP, `EN` y `PT` responden `409 VOICE_NOT_CONFIGURED` (AC 4.29), que es lo que el dashboard muestra con AC 3.78.
- [x] **API-19 — `regenerate-verdict` (D17)** — bloqueante (AC 3.81-3.85). **Hecho 2026-09-26** (migración `20260926120000_add_verdict_history`, sin FK a `Agent`; `decision-log.md` entrada 35). Tabla `VerdictHistory` (migración aditiva), `DebateService.replaceVerdict` (transacción: archivar, borrar, crear), `EpisodeActionsService.regenerateVerdict` sincrónica dentro de `withLlmCall` con una segunda verificación de `PENDING_REVIEW` antes de escribir, acción en `ActionNameSchema` y el controller, `debate.verdict.stale` calculado (sin columna) en `getEpisodeDetail` y el mapper, fila en `api-contract.md` §5, `VerdictHistory` en `architecture.md` §6, `openapi.json` regenerado. **Requiere API-10b** (mismo mapeo de errores) y la extracción de `EpisodeContextService` (Fase 7, paso 5a): si la F2 llega antes que la 004, esa extracción es el primer commit de API-19; nunca una tercera copia de `buildDebateContext`.
- [x] **API-5** — bloqueante (AC 3.10-3.14). **Hecho 2026-09-25** (entrada 34): schemas de respuesta de notificaciones en `openapi.json`.
- [x] **API-12** — bloqueante (AC 3.32, 3.35, 3.38, 3.39): `pipelineActive` en `getEpisodeDetail`; el SSE completa enseguida si el pipeline no está activo. **Hecho 2026-09-25** (entrada 34); tras el review, el SSE responde `204` sin pipeline activo y `404` si el episodio no existe.
- [x] **API-13** — bloqueante (AC 3.33). **Hecho 2026-09-25** (entrada 34; `no-transform` ya lo pone Nest): evento SSE `heartbeat` cada 15 s + `Cache-Control: no-transform` (ADR 0001 punto 6).
- [x] **API-10b** — **hecho 2026-09-26** (entrada 35; también cubre `TtsProviderUnavailableError`). No bloqueante según la spec, pero **prerrequisito de API-19**, así que en la práctica entra en la ruta crítica de F2 (AC 3.50, 3.62, 3.85): `BudgetExceededError` → `409 USAGE_LIMIT_EXCEEDED`, errores de proveedor → `503 PROVIDER_QUOTA_EXCEEDED` en `regenerate`/`regenerate-audio`. Sirve también a F3.
- [x] **API-10** (HECHO 2026-09-28) — no bloqueante, recomendado antes de F2: bodies, respuestas y códigos de error de `runEpisodeAction` en `openapi.json` (incluido `VOICE_NOT_CONFIGURED`, que existe recién tras la Fase 7 paso 6, y la acción `regenerate-verdict` de API-19); corrección de la documentación de `argument.approved`.
- [x] **API-14** — **hecho 2026-09-26** (entrada 35). Importante, no bloqueante: `edit`/`regenerate` validan que el `argumentId` pertenezca al episodio (`404`).
- [ ] **API-16** — no bloqueante (parte de AC 3.51): `maxTtsSegments` en `UsageLimitResumeSchema`.
- [ ] **API-18** — no bloqueante, sin fase asignada en la spec (parte de AC 3.51, fila `VOICE_NOT_CONFIGURED`): exponer qué agentes no tienen voz en un `VOICE_NOT_CONFIGURED` (hoy el checkpoint solo trae el motivo). Depende de la Fase 7 paso 6 (`VoiceNotConfiguredError`). **El mecanismo no está especificado** (ver "Decisiones abiertas"); sin API-18 el panel lista todos los participantes.
- [x] **API-15** — **hecho 2026-09-26** (entrada 35). Menor: `resume` valida el estado antes de aplicar límites nuevos.
- [~] **API-6** (`VALIDATION_ERROR` hecho con API-10) — mejora: filtro `status` de `listEpisodes` tipado; `VALIDATION_ERROR` en vez de `BADREQUEST`.
- [ ] **API-11** — mejora, no necesaria (la spec la cubre con polling): eventos SSE para `APPROVED`/`GENERATING_AUDIO`.

**6.3 — Antes de F3 (preview con audio)**
- [ ] **`packages/video` como librería** (spec, "Restricciones técnicas", puntos 1-3): `src/studio.ts` con `registerRoot`, `index.ts` sin efectos con los exports de la spec y `DEBATE_VIDEO`, `peerDependencies`, `@remotion/player` movido a `apps/dashboard`. Con **audio real en la composición** (pendiente heredado de la spec 002).
- [ ] **Catálogo de pnpm** (punto 4): React `19.3.0` y Remotion `4.0.528` exactos; criterio `pnpm why react` con una sola versión.

**6.4 — Antes de F4 (publicación y showcase)**
- [ ] **API-7 — Showcase y publicación** — bloqueante para publicar (AC 3.64-3.72): acciones `publish`/`unpublish` que escriben el `publishedAt` de API-7a, `showcase.controller.ts` público (`GET /showcase/episodes` con `{ id, title, createdAt, durationSec, language }[]`, `GET /showcase/episodes/:id` con el idioma en `manifest.meta.language`) filtrado por `publishedAt` y `SHOWCASE_STATUSES`, sin exponer el origen de los argumentos (D18). La columna y su exposición en el panel ya no son parte de API-7 (pasaron a API-7a, F2). Requiere la Fase 7 cerrada (el `language` de la lista pública sale de `Episode.language`).
- [ ] **Ajuste de `coding-rules.md` §1** — varios controllers por módulo cuando la política de acceso es distinta (spec, "Dependencias"; F4).
- [ ] **API-8 en producción con TTL de audio 3600 s** (D12) y sin `/docs` (D20).

**No MVP (nice-to-have, no se implementan sin pedirlo)**: API-2 (fuentes de la Evidence Base), API-3 (fact-checks por argumento, Feature 10), API-4 (`ArgumentHistory`). API-9 está cerrado vía API-1.

**Criterio de completitud de la fase**: los criterios de cada fase del front que dependen de estos ítems (`apps/dashboard/docs/roadmap.md`) dan verde, y además: `pnpm openapi:generate && git diff --exit-code openapi.json` sigue en 0; sin sesión, las acciones de la API devuelven `401` con curl (spec, "Criterio de aceptación").

## Fase 7 — Idioma del debate por episodio (spec 004)

Objetivo: que el curador elija el idioma del debate (`ES` neutro latinoamericano, `EN`, `PT`) al crear el episodio, persistido e inmutable en `Episode.language`, y que todo el pipeline (research, debate, fact-check, veredicto, audio, manifest) lo respete también tras cortes y reanudaciones. Spec `docs/product/004-debate-language.md`; voces en `AgentVoice` según `docs/adr/0002-voces-por-agente-e-idioma.md`. Backend, contratos (`packages/contracts`) y fixture de `packages/video`; la UI va dentro de la spec 003. Detalle tarea por tarea en `tasks.md` §13.

**Es bloqueante de la F2 del dashboard vía API-17** (y aporta el `language` de API-1). Aunque está numerada después, se intercala con la Fase 6. **Alcance del MVP tras D20 (2026-09-27)**: solo `ES` produce episodios; `EN` y `PT` están en el enum, pero crear un episodio en esos idiomas responde `409 VOICE_NOT_CONFIGURED` sin crear filas (AC 4.29) hasta la mejora posterior "Voces EN/PT" (7.4), que no se implementa sin pedirlo.

Sigue los pasos del "Plan de implementación" de la spec, que ya vienen en orden de dependencia:

**7.0 — Voces y preguntas abiertas (resueltas el 2026-09-25; voces `EN`/`PT` a mejora posterior el 2026-09-27)**
- [x] **Paso 1 — Voces: el MVP no requiere voces nuevas**. `ES` conserva las 5 voces actuales del seed (mezcla `es_ES`/`es_MX`), que la migración del paso 4 copia como `ES` (D5: la variante rige el texto, no el timbre). Catálogo real consultado el 2026-09-25 (`es` 7 voces, solo 2 `es_MX` y ninguna de otra región latinoamericana; `en` 35; `pt` 3, todas masculinas). Por D20 (2026-09-27), elegir las 5 voces `en_US`, fijar la asignación `PT` con repetición, el spike de velocidad/tono y documentarlo en `tasks.md` §5 pasaron a la mejora posterior "Voces EN/PT" (7.4). Sin pendientes para el MVP.
- [x] **Paso 2 — Preguntas abiertas A y B**: resueltas por el usuario (spec 004, "Preguntas abiertas"). A → `ES` como en el paso 1; la parte `EN`/`PT` queda como referencia para la mejora 7.4 (D20). B → la migración del paso 4 completa `AudioAsset.voiceId` de los assets existentes con la voz `LOCAL` que tenía su agente.

**7.1 — Sin dependencias, se puede hacer ya**
- [x] **Paso 3 — Contratos** (**hecho 2026-09-25**, entrada 34; `meta.language` sale `"ES"` fijo hasta el paso 7): `DebateLanguageSchema` en `packages/contracts`, `meta.language` obligatorio en `RemotionManifestSchema`, fixture de `packages/video` con `"language": "ES"` (AC 4.19).
- [x] **Paso 5a — `EpisodeContextService.build(episodeId)`** (**hecho 2026-09-25**, entrada 34) reemplaza las dos copias de `buildDebateContext` (`episode-orchestrator.service.ts:496`, `episode-actions.service.ts:219`) **sin cambio de comportamiento**, tests en verde (prepara AC 4.12). Refactor puro: se puede adelantar, y es prerrequisito de API-19 (si API-19 llega antes, esta extracción es su primer commit). Toca los mismos archivos que API-10b/API-14/API-15/API-19 (ver "Orden crítico").

**7.2 — Pipeline, TTS y API**
- [x] **Paso 4 — Schema y migración manual** (HECHO 2026-09-27, `decision-log.md` entrada 36; `CheckpointReason.VOICE_NOT_CONFIGURED` pasó al paso 6) (ADR 0002 punto 7): `AgentVoice`, copia de voces `ES` con `json_each` sin `TBD`, `AudioAsset.voiceId` completado en los assets existentes con la voz `LOCAL` de su agente (pregunta B) antes de reconstruir `Agent`, `Agent` reconstruida sin `voiceId`, `Episode.language NOT NULL DEFAULT 'ES'`, aplicada con `migrate deploy`; revisión previa de `dev.db`; seed idempotente con solo voces `ES` (`LOCAL` con las 5 actuales y `GOOGLE_TTS` con `"es"`), igual en base migrada y base nueva (AC 4.5, 4.16, 4.25). Requiere las migraciones de API-7a y `VerdictHistory`, ya aplicadas; ya no depende del paso 1. **Es el próximo paso de la ruta crítica de la F2.**
- [x] **Paso 5b — Prompts** (HECHO 2026-09-28, `decision-log.md` entrada 40) sin voseo, `buildLanguageInstruction` para los 3 idiomas, `CONTRARIAN.voice` neutralizado (AC 4.6, 4.7 parte tests, 4.9, 4.26, 4.27). Requiere 5a y 4.
- [x] **Paso 5c — `language` por parámetro** (HECHO 2026-09-28) a `FactCheckService`, `ResearchService` y `DebateContext` (AC 4.10-4.13, con filas `AgentVoice` de prueba e ids ficticios para `EN`/`PT`, D14). Requiere 5a y 4.
- [x] **Paso 6 — TTS** (HECHO 2026-09-27, `decision-log.md` entrada 37; el review movió el `voiceId` del manifest al paso 7, D17 revisado): `resolveVoiceId(agent, language)`, `assertVoicesConfigured` sobre los 5 agentes candidatos antes del primer insert, `VoiceNotConfiguredError` (`409` + checkpoint), arranque solo con `LOCAL`, `AudioAsset.voiceId`, y test de integración de AC 4.29 a nivel servicio (base con solo `ES`: `EN`/`PT` → `VOICE_NOT_CONFIGURED` sin filas) (AC 4.4, 4.14-4.16, 4.24, 4.28). Requiere 4.
- [x] **Paso 7 — API** (HECHO 2026-09-27, `decision-log.md` entrada 38; incluye `voiceId` nullable del manifest, D17 revisado): DTOs, respuestas y `pnpm openapi:generate` (AC 4.18, 4.19), más el test HTTP y la llamada real que cierran AC 4.29 (`EN`/`PT` → `409`, orden `400` Zod → `409` voces → inserts). **Cierra API-17 y la parte `language` de API-1.** Requiere 3, 4 y 6.
- [ ] **Paso 8 — Smoke test real `ES`** hasta `READY_FOR_RENDER` (idioma, tuteo, audio, subtítulos y `feedback.details`) y un episodio anterior a la migración que sigue abriendo detalle y manifest, resultados en `decision-log.md` (AC 4.8 parte `ES`, 4.27). Requiere 5b, 5c, 6 y 7. Los smoke tests `EN`/`PT` pasaron a la mejora 7.4.
- [ ] **Paso 9 — Docs**: `api-contract.md` §1-§2 (incluido que en el MVP `VOICE_NOT_CONFIGURED` es la respuesta para `EN`/`PT`), `setup.md`, `decision-log.md` (nota de que el punto 1 de #20 queda reemplazado por el ADR 0002). `features.md` no se toca.

**7.3 — Dashboard**
- [ ] **Paso 10** — AC 4.20-4.23: se implementan dentro de la spec 003 (F2: AC 4.20-4.22 = AC 3.22, 3.78, 3.17, 3.26; F4: AC 4.23 = AC 3.66, 3.67). Se trackean en `apps/dashboard/docs/tasks.md`, no acá.

**7.4 — Mejora posterior "Voces EN/PT" (D20; no es MVP, no se implementa sin pedirlo)**
- [ ] Elegir 5 voces `en_US` distintas, cargar la asignación `PT` con repetición, spike de velocidad/tono `PT`, confirmar las variantes de D5 y documentar en `tasks.md` §5; seed `EN`/`PT` para `LOCAL` (más las filas `GOOGLE_TTS` `"en"`/`"pt"`, con la mejora o con el proveedor Google, lo que ocurra primero) y consulta de AC 4.30; smoke tests reales `EN` y `PT` hasta `READY_FOR_RENDER` (AC 4.7 parte smoke, 4.8 parte `EN`/`PT`, 4.17) y revisión de D10 para esos idiomas. Sin código nuevo de pipeline, API ni dashboard. Criterio para retomarla: el curador decide producir episodios en inglés o portugués, con el MVP de la Fase 7 implementado (AC 4.29 pasa), o existe un segundo motor de TTS. Detalle en `tasks.md` §13.11.

**Criterio de completitud de la fase (MVP)** (spec 004, "Criterio de aceptación"): `pnpm build` y tests en verde; `pnpm openapi:generate && git diff --exit-code openapi.json` en 0; `check-boundaries` pasa y `pnpm video:studio` renderiza el fixture sin `.env` ni base; tests de AC 4.1-4.6, 4.7 (parte tests), 4.9-4.16, 4.18, 4.24, 4.28 y 4.29 en verde; consulta directa para AC 4.5/4.25 (solo `ES`, igual en base migrada y base nueva) y búsqueda en el código para AC 4.26; smoke test real en `ES` (AC 4.8 parte `ES`, 4.27) con resultados en `decision-log.md`, y llamada real que confirma el `409` de `EN`/`PT` (AC 4.29); un episodio anterior a la migración sigue abriendo detalle y manifest como `ES`. AC 4.20-4.23 se verifican con las pantallas de la spec 003. La mejora 7.4 se cierra aparte, con AC 4.30, AC 4.17, la parte smoke de AC 4.7 y la parte `EN`/`PT` de AC 4.8.

### Orden crítico entre la Fase 6 y la Fase 7

Las dos fases tocan los mismos puntos: `EpisodesService` (`getEpisodeDetail`, `listEpisodes` y su `select` de `episodes.service.ts:60`, `getManifest`), los schemas de DTO (`EpisodeDetailSchema`, `EpisodeListItemSchema`, `EpisodeSchema`) y el mapper del detalle, `schema.prisma` (migraciones), `episode-actions.service.ts` y `openapi.json`. Para no pisarse:

1. **Cola de migraciones: una a la vez, en serie.** Orden: API-7a (`Episode.publishedAt`) → API-19 (`VerdictHistory`, aditiva) → Fase 7 paso 4 (la manual, que reconstruye `Agent` y agrega `Episode.language`). Las dos aditivas van primero porque no esperan a nada; la grande se escribe al final sobre el schema final. Si `VerdictHistory` referencia a `Agent` (por ejemplo, el ganador), la reconstrucción de `Agent` del paso 4 tiene que incluir esa FK en su patrón `PRAGMA`. **Aplicadas las dos aditivas (2026-09-26)**: `VerdictHistory` quedó **sin FK a `Agent`** (`judgeId`/`winnerId` son texto plano, como `Verdict.winnerId`), así que el paso 4 no tiene que recrear ninguna FK nueva (`tasks.md` §13.4).
2. **API-1 en dos partes**: tópico/`createdAt`/participantes junto con API-7a (misma superficie: detalle + listado); `language` en el paso 7 de la Fase 7, sobre ese mismo mapeo (`mapEpisodeDetail` y el `select` del listado). `debate.verdict.stale` de API-19 también entra en ese mapper: mergear en serie.
3. **`EpisodeContextService` (paso 5a) primero entre todo lo que toca `episode-actions.service.ts`**: antes de API-19 (obligatorio; si la F2 llega antes que la 004, es el primer commit de API-19, nunca una tercera copia de `buildDebateContext`) y, sin paralelismo, antes o después de API-10b, API-14 y API-15.
4. **API-10b antes de API-19**: `regenerate-verdict` nace con el mismo mapeo de errores.
5. **`openapi.json` se regenera y commitea en cada ítem**, y cada ítem arranca desde el anterior ya mergeado (criterio de idempotencia de la spec 001). No acumular cambios de contrato de las dos fases en ramas paralelas.
6. **Ruta crítica de la F2 del dashboard**, sin decisiones del usuario en el medio: API-8 (F1) → { API-1 parte 1 + API-7a, API-5, API-12, API-13, API-10b, paso 3, paso 5a } (todo hecho) → API-19 (hecha) → paso 4 → paso 6 → paso 7 (cierra API-17 y API-1). Los pasos 5b, 5c, 8 y 9 no bloquean la F2 (API-17 no los necesita), pero sí el cierre del MVP de la spec 004; 5c y el paso 6 tocan `episode-orchestrator.service.ts`, así que van en serie. El paso 1 ya no está en la ruta crítica: por D20 el MVP no requiere voces nuevas, y las voces `EN`/`PT` (con el spike de tono `PT`) son la mejora 7.4.
7. **API-10 y API-18 después del paso 6**: el código `VOICE_NOT_CONFIGURED` y `VoiceNotConfiguredError` nacen ahí. API-10 también documenta `regenerate-verdict`, así que conviene después de API-19.
8. **API-7 (F4) después de la Fase 7**: `listShowcaseEpisodes` devuelve `language`. Basta el MVP de la Fase 7; no espera a la mejora 7.4.
9. **Relación con la 004**: si la 004 define cómo el juez usa el idioma, `regenerate-verdict` lo respeta (spec 003, "Dependencias"); con `EpisodeContextService` compartido, el contexto del juez sale del mismo lugar en los dos caminos.

## Decisiones abiertas (el usuario debe resolverlas, no se infieren)

- **Estrategia de seed/fixtures de la Evidence Base para desarrollo local** (`tasks.md` §9) — research contra APIs reales tiene costo; hay que decidir si se graban fixtures de respuestas reales, se usa un proveedor de bajo costo en dev, o se mockea por completo mientras no se apunte a producción.
- **Proveedor de storage para `AudioAsset`** — `features.md` (AC 6.1) exige abstraer disco local / S3 / R2 / GCS pero no fija cuál usar en el MVP.
- **API-18 — cómo exponer los agentes sin voz** (no bloqueante; para `architect`) — la spec 003 pide el dato pero no el mecanismo (el checkpoint solo guarda el motivo). Antes de implementarlo hay que decidir dónde vive (campo nuevo en `EpisodeCheckpoint`, derivarlo al vuelo en `getEpisodeDetail` contra `AgentVoice`, etc.).

La spec 003 ya no tiene preguntas abiertas para el usuario.

**Resueltas**: proveedor de búsqueda web para Research → **Tavily** (`tasks.md` §1, decidido 2026-09-08). Auth del dashboard → **ADR 0001** (sesión emitida por Nest, Next como único origen, 2026-09-25). `publishedAt` en F2 → **API-7a** (decisión del usuario, spec 003 D10, 2026-09-25). Voces por agente e idioma → **ADR 0002** (tabla `AgentVoice`, 2026-09-25). Spec 004, pregunta A (voces insuficientes) → **`ES` conserva la mezcla actual `es_ES`/`es_MX` hasta que haya otro motor; `EN` con 5 voces `en_US` distintas; `PT` con voces repetidas (juez con voz propia) y spike de tono** (decisión del usuario, 2026-09-25; `EN` y `PT` pasaron a la mejora 7.4 por D20). Spec 004, voces `EN`/`PT` en el MVP → **fuera del MVP, mejora posterior "Voces EN/PT"; en el MVP `EN`/`PT` responden `409 VOICE_NOT_CONFIGURED`; descartados ocultar `EN`/`PT` en el selector y recortar el enum** (D20, decisión del usuario, 2026-09-27). Spec 004, pregunta B (voz de los episodios `ES` existentes) → **la migración completa `AudioAsset.voiceId` con la voz `LOCAL` que tenía cada agente** (decisión del usuario, 2026-09-25). Spec 003, pregunta 4 (origen `HUMAN_EDITED` en el showcase) → **D18: no se muestra** (2026-09-25). Spec 003, pregunta 5 (veredicto tras editar/regenerar) → **D17: aviso + `regenerate-verdict` (API-19)** (2026-09-25). Spec 003, pregunta 7 (idioma de la interfaz del showcase) → **D16: español en F4 bajo `/[locale]` con `es` como único valor; i18n completo como nice-to-have** (2026-09-25; solo front). Spec 003, pregunta 8 (intervalos de polling) → **D19: 30 s inbox, 10 s detalle y lista, en constantes centralizadas** (2026-09-25; solo front). Spec 003, pregunta 10 (`/docs` en producción) → **D20: solo fuera de producción, dentro de API-8** (2026-09-25).

## Referencias

- `tasks.md` — estado detallado ítem por ítem (fuente de verdad de qué está hecho).
- `architecture.md` — cómo se implementa cada pieza, algoritmo de orquestación (§7).
- `features.md` — qué hace cada feature, criterios de aceptación, prioridad P0/P1 (MVP v1.0, congelado).
- `api-contract.md` — superficie HTTP completa.
- `coding-rules.md` — convenciones a respetar en cada tarea de este roadmap.
- `docs/product/` — specs post-MVP (Fase 5 en adelante), un archivo por spec, numeradas.
- `docs/adr/` — decisiones de arquitectura (ADR 0001: auth del dashboard; ADR 0002: voces por agente e idioma).
- `apps/dashboard/docs/` — tracking propio del frontend (fases F1-F4 de la spec 003).
