# Roadmap — AI Trend Debates

Documento de secuenciación. No repite el detalle de cada ítem (eso vive en `tasks.md`) — organiza y prioriza lo que `tasks.md` ya trackea, en el orden en que técnicamente conviene implementarlo, respetando las dependencias de `architecture.md` (sección 3, dirección de dependencias) y las prioridades P0/P1 de `features.md`. No agrega alcance nuevo: cada tarea referencia su ítem equivalente en `tasks.md`.

Última revisión: 2026-09-25 (spec 003 escrita y revisada por `architect`, ADR 0001 aceptado; nueva Fase 6 con las dependencias de backend de la spec 003). Revisión previa: 2026-09-24 (Feature 7 completa — MVP P0 cerrado; Fase 5 completa — specs 001 y 002 implementadas, ver `decision-log.md` entradas 28-30).

## Objetivo

Llevar el backend desde su estado actual (schema, contratos y factory de modelos ya definidos, pero sin wiring de runtime ni módulos de dominio) hasta un pipeline de punta a punta que genere un debate verificado y auditado por un humano (MVP P0), y después sumar audio y render (P1) para completar el producto audiovisual.

## Próximo paso inmediato

**MVP P0 completo (2026-09-24, `decision-log.md` entrada 27)**: con Feature 7 (Remotion Manifest) implementada y verificada contra el servidor y el motor reales, **todo lo marcado P0 en `features.md` queda cubierto de punta a punta**: `POST /episodes` → research → debate (OPENING/REBUTTAL/CROSS_EXAMINATION) con fact-check/enmienda → veredicto → `PENDING_REVIEW` → curaduría humana → TTS (URLs firmadas + regeneración atómica) → `GET /episodes/:id/manifest` con subtítulos reales y audio firmado, listo para que un worker de Remotion lo consuma. Ver `tasks.md` §0-4/6/7 y `decision-log.md` entradas 1-27 para el detalle y el proceso de cada decisión no obvia.

**Próximo paso real**: no queda ningún ítem P0 pendiente, y la Fase 5 completa (specs 001 y 002, `decision-log.md` #29-30) — el repo ya es un monorepo `pnpm`+Turborepo real (`apps/api`+`packages/contracts`+`packages/video`+`apps/dashboard`), con `packages/video` verificado con un render real. Lo que sigue:
- **Spec 003 (UI real del dashboard) — escrita y revisada por `architect` (2026-09-25)**: `docs/product/003-dashboard-ui.md`, con la topología de auth en `docs/adr/0001-auth-sesion-nest-mismo-origen.md` (aceptado). Panel de curación privado bajo `/studio` + showcase público de episodios publicados. El tracking del front vive en `apps/dashboard/docs/roadmap.md` (fases F1-F4); **las dependencias de backend que pide la spec (API-1..API-16, auth, showcase, refactor de `packages/video`) son la Fase 6 de este roadmap** (`tasks.md` §12).
- **Feature 9 (Fase 4 más arriba)** — worker que ejecuta Remotion sobre el manifest y produce el `.mp4`. Ya no depende de nada nuevo: `packages/video` existe y sabe renderizar.
- **Backlog de TTS** (`tasks.md` §5) — Google/OpenRouter como proveedores adicionales, Chatterbox (motor GPU) para mejorar la calidad de voz de Piper.
- **Housekeeping menor** (`tasks.md` §9) — `04-development/testing-strategy.md`, estrategia de fixtures de Research para dev.

De estos, **la spec 003 es la continuación más directa** si el objetivo es tener una interfaz usable — es lo único que falta para poder curar episodios sin pegarle a la API a mano. Su primer paso es backend: **API-8 (auth, ADR 0001) antes de la F1 del front**, y API-1/API-5/API-12/API-13 antes de la F2 (Fase 6, más abajo). Feature 9 puede avanzar en paralelo, ya desbloqueada.

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
- [x] TTS: `AudioProvider` seleccionables vía env var (`tasks.md` §5, `decision-log.md` entradas 19-25). **Local (`echogarden`+Piper) completo y verificado contra el motor real** — `AudioStorageProvider`/`LocalDiskStorageProvider`, migración `Agent.voiceId` a `Json`, wiring completo en `EpisodeBudgetService`/`EpisodeStateService`/`EpisodeOrchestratorService`/`EpisodeRecoveryService`, smoke test real (`npm run smoke:tts`) en verde. **AC 6.1 (URLs firmadas) y AC 6.2 (regeneración atómica de `sequenceIndex`) completos y verificados contra el servidor real** (decision-log #25) — `GET /episodes/:id/audio/:audioAssetId/url` + `POST /episodes/:id/actions/regenerate-audio`. En backlog, no P0: Google (`google-tts-api`), OpenRouter (`fish-audio/s2.1-pro-free:free`, gateado por spike de validación), y un 4to proveedor GPU (`CHATTERBOX`, plan aprobado en decision-log #23, aislado a backlog en la entrada 24 — bloqueado por infraestructura local, Docker Desktop, ver `tasks.md` §5 "Backlog / mejoras futuras").
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

El tracking del dashboard en sí (framework, UI, autenticación) **no vive acá** — es `apps/dashboard/docs/roadmap.md`. La UI real del dashboard ya tiene su spec escrita (`docs/product/003-dashboard-ui.md`); lo que esa spec le pide al backend es la Fase 6.

## Fase 6 — Dependencias de backend de la spec 003 (dashboard)

Objetivo: dejar la API y el workspace en condiciones de que el dashboard (`apps/dashboard/docs/roadmap.md`, fases F1-F4) cumpla la spec `docs/product/003-dashboard-ui.md` sin duplicar tipos ni lógica de backend (D3, D5). Post-MVP, fuera de `features.md` (congelado). Cada ítem cita su API-n de la spec ("Cambios requeridos en la API") y los AC que desbloquea; la topología de auth es la del ADR 0001. Detalle ítem por ítem en `tasks.md` §12.

Ordenado por la fase del front que desbloquea. "Bloqueante"/"no bloqueante" es la clasificación de la propia spec.

**6.1 — Antes de F1 (base del dashboard)**
- [ ] **API-8 — Módulo auth (ADR 0001)** — bloqueante (AC 3.1-3.9). `modules/auth` (`POST /auth/login`, `POST /auth/logout`, `GET /auth/session`), `SessionGuard` global que niega por defecto, `@Public()`, credenciales en `.env` sin defaults, rate-limit en login, `trust proxy`, `401` documentado en OpenAPI, sin `enableCors()`, `AUDIO_SIGNING_SECRET` obligatorio en producción. Es el primer paso de toda la spec: sin él la F1 no puede cumplir su criterio.
- [ ] **Workspace: `check-boundaries` extendido a `apps/dashboard`** (spec, "Límites del workspace"; F1) — prohíbe `@ai-trend-debates/api` e imports relativos fuera del paquete, detecta `import()` dinámico e `import "x"`, corre en CI o `prebuild`.
- [ ] **Workspace: `dev.dependsOn: ["^build"]` en el `turbo.json` raíz** (spec, "Turborepo y tipos").

**6.2 — Antes de F2 (panel de curación)** — recomendados en paralelo con F1 (spec, plan F1)
- [ ] **API-1** — bloqueante (AC 3.26-3.29, 3.32, 3.51): tópico, `createdAt` y participantes en `getEpisodeDetail`. Cierra también API-9.
- [ ] **API-5** — bloqueante (AC 3.10-3.14): schemas de respuesta de notificaciones en `openapi.json`.
- [ ] **API-12** — bloqueante (AC 3.32, 3.35, 3.38, 3.39): `pipelineActive` en `getEpisodeDetail`; el SSE completa enseguida si el pipeline no está activo.
- [ ] **API-13** — bloqueante (AC 3.33): evento SSE `heartbeat` cada 15 s + `Cache-Control: no-transform` (ADR 0001 punto 6).
- [ ] **API-10** — no bloqueante, recomendado antes de F2: bodies, respuestas y códigos de error de `runEpisodeAction` en `openapi.json`; corrección de la documentación de `argument.approved`.
- [ ] **API-10b** — no bloqueante (AC 3.50, 3.62): `BudgetExceededError` → `409 USAGE_LIMIT_EXCEEDED`, errores de proveedor → `503 PROVIDER_QUOTA_EXCEEDED` en `regenerate`/`regenerate-audio`. Sirve también a F3.
- [ ] **API-14** — importante, no bloqueante: `edit`/`regenerate` validan que el `argumentId` pertenezca al episodio (`404`).
- [ ] **API-16** — no bloqueante (parte de AC 3.51): `maxTtsSegments` en `UsageLimitResumeSchema`.
- [ ] **API-15** — menor: `resume` valida el estado antes de aplicar límites nuevos.
- [ ] **API-6** — mejora: filtro `status` de `listEpisodes` tipado; `VALIDATION_ERROR` en vez de `BADREQUEST`.
- [ ] **API-11** — mejora, no necesaria (la spec la cubre con polling): eventos SSE para `APPROVED`/`GENERATING_AUDIO`.

**6.3 — Antes de F3 (preview con audio)**
- [ ] **`packages/video` como librería** (spec, "Restricciones técnicas", puntos 1-3): `src/studio.ts` con `registerRoot`, `index.ts` sin efectos con los exports de la spec y `DEBATE_VIDEO`, `peerDependencies`, `@remotion/player` movido a `apps/dashboard`. Con **audio real en la composición** (pendiente heredado de la spec 002).
- [ ] **Catálogo de pnpm** (punto 4): React `19.3.0` y Remotion `4.0.528` exactos; criterio `pnpm why react` con una sola versión.

**6.4 — Antes de F4 (publicación y showcase)**
- [ ] **API-7 — Showcase y publicación** — bloqueante para publicar (AC 3.17, 3.26, 3.64-3.72): `Episode.publishedAt` + acciones `publish`/`unpublish`, `publishedAt` en detalle y lista, `showcase.controller.ts` público (`GET /showcase/episodes`, `GET /showcase/episodes/:id`) filtrado por `publishedAt` y `SHOWCASE_STATUSES`. Nota: `publishedAt` también lo usan AC 3.17/3.26, que caen en F2 (ver `apps/dashboard/docs/roadmap.md`, "Preguntas abiertas").
- [ ] **Ajuste de `coding-rules.md` §1** — varios controllers por módulo cuando la política de acceso es distinta (spec, "Dependencias"; F4).
- [ ] **API-8 en producción con TTL de audio 3600 s** (D12).

**No MVP (nice-to-have, no se implementan sin pedirlo)**: API-2 (fuentes de la Evidence Base), API-3 (fact-checks por argumento, Feature 10), API-4 (`ArgumentHistory`). API-9 está cerrado vía API-1.

**Criterio de completitud de la fase**: los criterios de cada fase del front que dependen de estos ítems (`apps/dashboard/docs/roadmap.md`) dan verde, y además: `pnpm openapi:generate && git diff --exit-code openapi.json` sigue en 0; sin sesión, las acciones de la API devuelven `401` con curl (spec, "Criterio de aceptación").

## Decisiones abiertas (el usuario debe resolverlas, no se infieren)

- **Estrategia de seed/fixtures de la Evidence Base para desarrollo local** (`tasks.md` §9) — research contra APIs reales tiene costo; hay que decidir si se graban fixtures de respuestas reales, se usa un proveedor de bajo costo en dev, o se mockea por completo mientras no se apunte a producción.
- **Proveedor de storage para `AudioAsset`** — `features.md` (AC 6.1) exige abstraer disco local / S3 / R2 / GCS pero no fija cuál usar en el MVP.
- **Spec 003, pregunta 4 — Origen `HUMAN_EDITED` en el showcase** (antes de F4; `docs/product/003-dashboard-ui.md`, "Preguntas abiertas") — ¿se le muestra al visitante qué partes editó el curador? Requeriría ampliar la respuesta pública de API-7.
- **Spec 003, pregunta 5 — Veredicto tras editar/regenerar** (antes de F2; misma sección) — ¿alcanza con un aviso en la UI o se espera algo del backend (fuera del alcance de la spec)?
- **Spec 003, pregunta 7 — Idioma del showcase** (antes de F4; misma sección) — español, inglés o el idioma de cada episodio.
- **Spec 003, pregunta 8 — Intervalos de polling** (F2; misma sección) — propuestos 30 s inbox y 10 s detalle; ¿alguna restricción de costo de hosting?
- **Spec 003, pregunta 10 — `/docs` en producción** (antes de F4; misma sección, y ADR 0001 "Consecuencias") — Swagger queda fuera del `SessionGuard`: ¿se desactiva, se protege o queda público?

**Resueltas**: proveedor de búsqueda web para Research → **Tavily** (`tasks.md` §1, decidido 2026-09-08). Auth del dashboard → **ADR 0001** (sesión emitida por Nest, Next como único origen, 2026-09-25).

## Referencias

- `tasks.md` — estado detallado ítem por ítem (fuente de verdad de qué está hecho).
- `architecture.md` — cómo se implementa cada pieza, algoritmo de orquestación (§7).
- `features.md` — qué hace cada feature, criterios de aceptación, prioridad P0/P1 (MVP v1.0, congelado).
- `api-contract.md` — superficie HTTP completa.
- `coding-rules.md` — convenciones a respetar en cada tarea de este roadmap.
- `docs/product/` — specs post-MVP (Fase 5 en adelante), un archivo por spec, numeradas.
- `docs/adr/` — decisiones de arquitectura (ADR 0001: auth del dashboard).
- `apps/dashboard/docs/` — tracking propio del frontend (fases F1-F4 de la spec 003).
