# Roadmap — AI Trend Debates

Documento de secuenciación. No repite el detalle de cada ítem (eso vive en `tasks.md`) — organiza y prioriza lo que `tasks.md` ya trackea, en el orden en que técnicamente conviene implementarlo, respetando las dependencias de `architecture.md` (sección 3, dirección de dependencias) y las prioridades P0/P1 de `features.md`. No agrega alcance nuevo: cada tarea referencia su ítem equivalente en `tasks.md`.

Última revisión: 2026-09-24 (Feature 7 completa — MVP P0 cerrado; spec 001 de Fase 5 implementada — ver `decision-log.md` entradas 28-29).

## Objetivo

Llevar el backend desde su estado actual (schema, contratos y factory de modelos ya definidos, pero sin wiring de runtime ni módulos de dominio) hasta un pipeline de punta a punta que genere un debate verificado y auditado por un humano (MVP P0), y después sumar audio y render (P1) para completar el producto audiovisual.

## Próximo paso inmediato

**MVP P0 completo (2026-09-24, `decision-log.md` entrada 27)**: con Feature 7 (Remotion Manifest) implementada y verificada contra el servidor y el motor reales, **todo lo marcado P0 en `features.md` queda cubierto de punta a punta**: `POST /episodes` → research → debate (OPENING/REBUTTAL/CROSS_EXAMINATION) con fact-check/enmienda → veredicto → `PENDING_REVIEW` → curaduría humana → TTS (URLs firmadas + regeneración atómica) → `GET /episodes/:id/manifest` con subtítulos reales y audio firmado, listo para que un worker de Remotion lo consuma. Ver `tasks.md` §0-4/6/7 y `decision-log.md` entradas 1-27 para el detalle y el proceso de cada decisión no obvia.

**Próximo paso real**: no queda ningún ítem P0 pendiente. Con la spec 001 (contrato OpenAPI) implementada y verificada (`decision-log.md` #29), lo que sigue:
- **Spec 002 (Fase 5 más abajo, `docs/product/002-workspace-restructure.md`)** — reestructuración a monorepo (`pnpm` + Turborepo, `apps/api`+`packages/contracts`+`packages/video`+`apps/dashboard` scaffold vacío). Ya no está bloqueada (requería 001 mergeada, ya lo está) — es el prerrequisito real para que el frontend pueda arrancar con un contrato tipado en vez de duplicar tipos a mano.
- **Feature 9 (Fase 4 más arriba)** — worker que ejecuta Remotion sobre el manifest y produce el `.mp4`.
- **Frontend real (UI)** — bloqueado por la spec 002 (necesita el scaffold de `apps/dashboard`). Su propio tracking vive en `apps/dashboard/docs/roadmap.md`, no acá.
- **Backlog de TTS** (`tasks.md` §5) — Google/OpenRouter como proveedores adicionales, Chatterbox (motor GPU) para mejorar la calidad de voz de Piper.
- **Housekeeping menor** (`tasks.md` §9) — `04-development/testing-strategy.md`, estrategia de fixtures de Research para dev.

De estos, **la spec 002 es la continuación más directa** — ya desbloqueada, y el prerrequisito real para que el frontend arranque sobre bases sólidas. Feature 9 puede avanzar en paralelo — no depende de la spec 002 ni viceversa.

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
- [ ] Frontend: consumo del manifest vía `@remotion/player`

**Con Feature 7 cerrada, todo lo marcado P0 en `features.md` queda cubierto de punta a punta.**

## Fase 5 — Post-MVP: contrato de API y monorepo

Objetivo: preparar el terreno para que exista un frontend, sin construirlo todavía. `features.md` sigue congelado v1.0 (Features 1-10) — esto es trabajo nuevo, fuera de ese contrato, especificado en `docs/product/`. Detalle completo, decisiones y por qué se ajustaron respecto del texto original en `decision-log.md` entradas 28 (revisión) y 29 (implementación de la 001).

- [x] **`docs/product/001-openapi-contract-zod.md`** — COMPLETA (2026-09-24). `openapi.json` generado desde los contratos Zod ya existentes (`@nestjs/swagger` + `nestjs-zod`), `/docs` navegable. `RemotionManifest`/`EpisodeDetailResponse` migrados a schemas Zod, 6 schemas de eventos SSE (Feature 8) escritos contra los payloads reales. Verificado contra el servidor real. Detalle en `tasks.md` §10.
- [ ] **`docs/product/002-workspace-restructure.md`** (requería 001 mergeada — ya lo está) — monorepo `pnpm` + Turborepo: `apps/api` (este backend), `packages/contracts` (`RemotionManifest`), `packages/video` (Remotion, creado desde cero — no hay nada que migrar hoy), `apps/dashboard` (scaffold vacío, Next.js). Los docs de raíz de este repo (`roadmap.md` incluido) suben a la raíz del monorepo en este paso.

El tracking del dashboard en sí (framework, UI, autenticación) **no vive acá** — es `apps/dashboard/docs/roadmap.md`, creado como placeholder aunque `apps/dashboard/` todavía no exista como app real (ver decisión de dividir el tracking por dueño, entrada 28 del decision log).

## Decisiones abiertas (el usuario debe resolverlas, no se infieren)

- **Estrategia de seed/fixtures de la Evidence Base para desarrollo local** (`tasks.md` §9) — research contra APIs reales tiene costo; hay que decidir si se graban fixtures de respuestas reales, se usa un proveedor de bajo costo en dev, o se mockea por completo mientras no se apunte a producción.
- **Proveedor de storage para `AudioAsset`** — `features.md` (AC 6.1) exige abstraer disco local / S3 / R2 / GCS pero no fija cuál usar en el MVP; conviene decidirlo antes de arrancar TTS (Fase 3) para no re-trabajar el `AudioProvider`.

**Resueltas**: proveedor de búsqueda web para Research → **Tavily** (`tasks.md` §1, decidido 2026-09-08).

## Referencias

- `tasks.md` — estado detallado ítem por ítem (fuente de verdad de qué está hecho).
- `architecture.md` — cómo se implementa cada pieza, algoritmo de orquestación (§7).
- `features.md` — qué hace cada feature, criterios de aceptación, prioridad P0/P1 (MVP v1.0, congelado).
- `api-contract.md` — superficie HTTP completa.
- `coding-rules.md` — convenciones a respetar en cada tarea de este roadmap.
- `docs/product/` — specs post-MVP (Fase 5 en adelante), un archivo por spec, numeradas.
- `apps/dashboard/docs/` — tracking propio del frontend (placeholder hasta que exista `apps/dashboard` como app real).
