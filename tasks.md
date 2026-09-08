# Tasks — AI Trend Debates

Tracking del estado de implementación. No repite el diseño (eso vive en `architecture.md` / `features.md` / `api-contract.md` / `coding-rules.md`) — solo lista qué está hecho y qué falta, módulo por módulo, para saber en qué seguir sin releer todo el proyecto.

Convención: `[x]` hecho, `[ ]` pendiente, `[~]` empezado/parcial. Última revisión: 2026-09-07.

## 0. Fundacional (bloquea todo lo demás) — COMPLETA

- [x] `schema.prisma` completo (todas las entidades y enums de `architecture.md` sección 6)
- [x] Migraciones iniciales aplicadas (`prisma/migrations/`)
- [x] `shared/config/env.schema.ts` (Zod) + `validateEnv`
- [x] `shared/contracts/agents.contracts.ts` (schemas Zod + `DebateAgent` + `DebateContext`)
- [x] `shared/personas/agents.personas.ts` (4 personas debatientes + Judge + builders de system prompt)
- [x] `modules/ai/` — `ModelProviderFactory` (los 4 providers resueltos: OPENAI, GOOGLE, ANTHROPIC, XAI)
- [x] Dependencias de `package.json` alineadas y compilando (`npx tsc --noEmit` limpio, 2026-09-07):
  - `ai` no estaba instalado — agregado en la generación "ai-v6" (`^6.0.277`), la única compatible con Zod 4
  - `@ai-sdk/openai`/`@ai-sdk/google` estaban en la generación "ai v4" (`^4.0.x`, solo Zod 3) — repinneados a su equivalente "ai-v6" (`^3.0.109` / `^3.0.121` respectivamente; el número de versión más bajo es la generación más nueva, numeración propia de Vercel por paquete)
  - `@nestjs/config` estaba en `node_modules` sin declarar en `package.json`/`package-lock.json` (instalación fantasma que se hubiera perdido en un `npm ci`) — fijado en `^12.0.0`
  - Prisma Client nunca se había generado (`npx prisma generate`) — generado
  - Bug de import corregido: `modules/ai/model-provider.factory.ts` apuntaba a `../config/env.schema` (ruta inexistente) en vez de `../../shared/config/env.schema`
- [x] `shared/prisma/prisma.service.ts` + `PrismaModule` global (coding-rules.md §2):
  - Prisma 7 requiere driver adapter explícito incluso para SQLite (ya no hay motor nativo implícito) — se agregó `@prisma/adapter-better-sqlite3` + `better-sqlite3`, instanciado en `PrismaService` con la `DATABASE_URL` leída vía `ConfigService` (no `process.env` directo)
- [x] `AppModule` ahora importa `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` + `PrismaModule` + `AiModule` (coding-rules.md §8 — el proceso valida env y falla rápido si falta una key requerida; verificado manualmente con `node dist/src/main.js`)
- [x] `.env.example`/`.env` sincronizados con `env.schema.ts` (agregadas `ANTHROPIC_API_KEY`/`XAI_API_KEY`, ver nota de decisión abajo)
- [x] Habilitados `ANTHROPIC`/`XAI` en `ModelProviderFactory` (`@ai-sdk/anthropic@^3.0.116`, `@ai-sdk/xai@^3.0.130`, misma generación "ai-v6" que los otros dos providers — modelos por defecto `claude-sonnet-5` y `grok-4`, ajustables después)
- [x] Fix de infraestructura de tests, necesario para que `test/app.e2e-spec.ts` (bootstrapea `AppModule` completo) no rompiera al agregar `ConfigModule`: `@nestjs/config@12` se publica solo como ESM (`"type": "module"`, sin build CJS) — Node lo resuelve en runtime real vía `require(esm)` (soportado desde Node 22.12+), pero Jest no. Se agregó `transformIgnorePatterns` en `package.json` (jest unitario) y `test/jest-e2e.json` para que `ts-jest` transpile ese paquete en vez de ignorarlo. Además se agregó `test/jest-e2e.setup.ts` con un `GOOGLE_API_KEY` dummy para que los tests e2e no dependan de una key real.

**Decisión del usuario (2026-09-07) sobre validación de env vars de LLM**: solo `GOOGLE_API_KEY` es requerida (única con acceso gratuito hoy). `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` y `XAI_API_KEY` quedan `.optional()` en `env.schema.ts` — el proceso arranca sin ellas, y `ModelProviderFactory.resolve()` recién falla si algo intenta usar un provider sin key configurada. Revisar este criterio cuando se contrate una suscripción adecuada a los demás providers.

## 1. Research (`modules/research/`)

Entidades: `Topic`, `ResearchSession`, `Source`, `EvidenceFact`.

- [ ] Módulo no existe (`research.module.ts` / `.service.ts` / `.controller.ts`? / `.service.spec.ts` / `dto/`)
- [ ] Proveedor de búsqueda web (integración externa — falta decidir/contratar el proveedor)
- [ ] Política Cockatiel para el proveedor de búsqueda (coding-rules.md §4)
- [ ] Persistencia de `Source` con `fetchTimestamp`, `publishedAt`, `contentHash` (AC 1.2 — trazabilidad)
- [ ] Excepción tipada `InsufficientEvidenceError` (coding-rules.md §5) cuando hay <3 fuentes válidas
- [ ] Servicio de extracción de `EvidenceFact` usando `ResearchOutputSchema` (`generateObject`, ya definido en contracts)
- [ ] Tests unitarios con LLM/proveedor de búsqueda mockeado (coding-rules.md §9)

## 2. Agents (`modules/agents/`)

Entidad: `Agent`. Implementa `DebateAgent` (contrato ya definido).

- [ ] Módulo no existe (sin controller — no expone endpoints, ver coding-rules.md §1)
- [ ] Implementación de `DebateAgent.argue()` (OPENING/REBUTTAL) con `generateObject` + `ArgumentDraftSchema`
- [ ] Implementación de `DebateAgent.respond()` (CROSS_EXAMINATION) con `CrossExaminationDraftSchema`
- [ ] Implementación de `DebateAgent.amend()` (loop de enmienda, recibe `AmendmentFeedback`)
- [ ] Wiring de `buildDebaterSystemPrompt` / `buildJudgeSystemPrompt` (ya existen en `shared/personas/`) al armar el prompt real
- [ ] Política Cockatiel alrededor de las llamadas a LLM (coding-rules.md §4) — `.parse()` de Zod **dentro** del bloque reintentado
- [ ] Seed de los 4 `Agent` (Analyst/Contrarian/Diplomat/Provocateur) + 1 `Agent` Judge en la base (¿seed script o migración de datos?)
- [ ] Tests unitarios con LLM mockeado

## 3. Debate (`modules/debate/`)

Entidades: `Debate`, `DebateRound`, `Argument`, `ArgumentHistory`, `Verdict`.

- [ ] Módulo no existe
- [ ] Creación de `DebateRound` tipada por `RoundType`
- [ ] Promoción de `Argument` DRAFT → OFFICIAL (Feature 2 — aislar DRAFT del contexto del oponente)
- [ ] Selección aleatoria de `respondsToId` en CROSS_EXAMINATION (arquitectura §7.2 — evitar repetir target si hay más de uno disponible)
- [ ] Trazabilidad de mutación (`ArgumentHistory`, `Origin: Human_Edited` al editar — Feature 5)
- [ ] Persistencia de `Verdict` vía `VerdictOutputSchema`
- [ ] Tests unitarios

## 4. Fact-check (`modules/fact-check/`)

Entidades: `Claim`, `FactCheck`.

- [ ] Módulo no existe
- [ ] Claim extraction (`ClaimExtractionOutputSchema`, ya definido) — segmentar DRAFT en `FACTUAL`/`OPINION`/`PREDICTION`/`SUBJECTIVE`
- [ ] Fact-checking estricto de claims `FACTUAL` contra la Evidence Base (`FactCheckOutputSchema`) — trazabilidad obligatoria a `sourceIds` (AC 1.2)
- [ ] Filtro editorial para claims no factuales (`EditorialReviewOutputSchema`) usando `persona.editorialRules`
- [ ] Paralelización de fact-checking agrupada por `ModelProvider` (arquitectura §7.3 — nunca 2 llamadas concurrentes al mismo provider)
- [ ] Excepción tipada para `MAX_REVISIONS_EXCEEDED` (coding-rules.md §5)
- [ ] Tests unitarios

## 5. TTS (`modules/tts/`)

Entidad: `AudioAsset`.

- [ ] Módulo no existe
- [ ] `AudioProvider` interface/abstracción (google-tts-api como implementación inicial, ver architecture.md stack)
- [ ] Generación de `AudioAsset` por segmento (`storageKey`, `provider`, `durationMs`, `mimeType`)
- [ ] Presigned URLs bajo demanda (AC 6.1) — abstrae disco local / S3 / R2 / GCS
- [ ] Regeneración atómica de un único `sequenceIndex` sin alterar el resto (AC 6.2)
- [ ] Política Cockatiel alrededor de google-tts-api/ElevenLabs (coding-rules.md §4)
- [ ] Tests unitarios

## 6. Render (`modules/render/`)

Entidad: `Asset`. P1 según features.md — no bloquea el MVP core.

- [ ] Módulo no existe
- [ ] Generación de `RemotionManifest` (contrato JSON ya definido en Feature 7 de `features.md`)
- [ ] Worker desacoplado que ejecuta el binario de Remotion (Feature 9, P1)
- [ ] `GET /episodes/:id/manifest` con URLs firmadas resueltas (api-contract.md §2, marcado P1)

## 7. Episodes — el orquestador (`modules/episodes/`)

Entidades: `Episode`, `EpisodeParticipant`, `EpisodeUsage`, `EpisodeCheckpoint`. Único módulo que conoce el pipeline completo y el único que escribe `Episode.status`.

- [ ] Módulo no existe
- [ ] `EpisodeStateService` (coding-rules.md §6) — único escritor de `Episode.status`, un método por transición válida
- [ ] Selección de participantes al crear el episodio (arquitectura §7.1 — 2 de 4 personas + Judge con provider distinto + sorteo de orden de turnos)
- [ ] Loop de rondas OPENING → REBUTTAL → CROSS_EXAMINATION (arquitectura §7.2)
- [ ] `procesarBorrador` — orquesta claim extraction + fact-check/editorial + loop de enmienda (arquitectura §7.3)
- [ ] Chequeo de presupuesto (`EpisodeUsage` vs `maxLlmCalls`/`maxSearchQueries`/`maxTtsSegments`) antes de cada llamada externa (AC 2.1)
- [ ] Persistencia de `EpisodeCheckpoint` como historial (nunca se pisa) al entrar a `REQUIRES_HUMAN_REVIEW`
- [ ] Lógica de `Resume` (retoma desde `checkpoint.fromState`/`debateRoundId`) y escalado a `FAILED` si la misma causa se repite tras un resume
- [ ] Idempotencia post-caída del proceso (Feature 4 — inspeccionar último estado persistido al reiniciar)
- [ ] `episodes.controller.ts`:
  - [ ] `POST /episodes`
  - [ ] `GET /episodes` (filtrable por `status`)
  - [ ] `GET /episodes/:id`
  - [ ] `GET /episodes/:id/audio/:audioAssetId/url`
  - [ ] `POST /episodes/:id/actions/approve`
  - [ ] `POST /episodes/:id/actions/edit`
  - [ ] `POST /episodes/:id/actions/regenerate`
  - [ ] `POST /episodes/:id/actions/reject`
  - [ ] `POST /episodes/:id/actions/resume`
  - [ ] Validar tabla de estados válidos por acción (api-contract.md §5) → `409 Conflict` con `code: INVALID_STATE_TRANSITION` fuera de tabla
- [ ] DTOs Zod separados de los contratos de agentes (coding-rules.md §3 — no reutilizar `ArgumentDraftSchema` como DTO)
- [ ] Tests de integración orquestando varios módulos con todo mockeado en el borde externo (coding-rules.md §9 — únicos tests de integración del proyecto)

## 8. Real-time (SSE)

- [ ] `GET /episodes/:id/events` (`text/event-stream`)
- [ ] Emisión de los 6 eventos definidos (api-contract.md §4): `research.started`, `agent.thinking`, `fact_check.completed`, `argument.approved`, `episode.pending_review`, `episode.requires_review`

## 9. Transversal / infraestructura

- [ ] Formato de error HTTP consistente `{ "error": { "code": string, "message": string } }` (api-contract.md §1)
- [ ] Seed inicial de datos (`Agent` x5, config default de `Episode`)
- [ ] `README.md` sigue siendo el boilerplate default de NestJS — reemplazar por descripción real del proyecto cuando el resto avance
- [ ] `04-development/testing-strategy.md` — mencionado como pendiente en `coding-rules.md` §9, escribir cuando haya al menos un módulo implementado
- [ ] Decidir estrategia de seed/fixtures de `Evidence Base` para desarrollo local (research contra APIs reales cuesta $ — ver límites de Feature 2)

## Referencias

- `architecture.md` — cómo se implementa cada pieza.
- `features.md` — qué hace cada feature y sus criterios de aceptación.
- `api-contract.md` — superficie HTTP completa.
- `coding-rules.md` — convenciones de código a seguir al implementar cada ítem de arriba.
