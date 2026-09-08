# Tasks — AI Trend Debates

Tracking del estado de implementación. No repite el diseño (eso vive en `architecture.md` / `features.md` / `api-contract.md` / `coding-rules.md`) — solo lista qué está hecho y qué falta, módulo por módulo, para saber en qué seguir sin releer todo el proyecto.

Convención: `[x]` hecho, `[ ]` pendiente, `[~]` empezado/parcial. Última revisión: 2026-09-08.

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

## 1. Research (`modules/research/`) — COMPLETA (código + tests), falta acción del usuario (API key real)

Entidades: `Topic`, `ResearchSession`, `Source`, `EvidenceFact`.

- [x] Módulo (`research.module.ts` + `research.service.ts` + `tavily.provider.ts` + `research.errors.ts` + specs, sin controller — coding-rules.md §1, mismo criterio que `AgentsModule`: lo orquesta `EpisodesModule`, que todavía no existe)
- [x] **Proveedor de búsqueda web decidido: Tavily** (investigado 2026-09-08 — free tier 1000 créditos/mes sin tarjeta, pensado para agentes LLM, encaja con `Source.title`/`url`/`snippet`). `TAVILY_API_KEY` agregada como **requerida** en `env.schema.ts`/`.env.example` (a diferencia de OPENAI/ANTHROPIC/XAI que son opcionales — Research es P0, no tiene sentido arrancar sin poder ejecutar una research real)
  - **Acción pendiente del usuario**: generar una key real en https://app.tavily.com y completarla en `.env` — con `TAVILY_API_KEY` vacía el proceso NO arranca (`validateEnv` falla rápido, coding-rules.md §8, a propósito). Los tests no la necesitan real: `test/jest-e2e.setup.ts` ya tiene un valor dummy.
- [x] Política Cockatiel para el proveedor de búsqueda (`tavily.provider.ts`, `maxAttempts: 3`) — separada de la política de `generateObject` de `research.service.ts` (fallan distinto, coding-rules.md §4)
- [x] Persistencia de `Source` con `fetchTimestamp` (default de schema), `publishedAt` (queda `null` — Tavily no lo devuelve en `/search` general, ya es opcional en el schema), `contentHash` (sha256 del `content` calculado en `ResearchService.research()`, usado también para deduplicar resultados antes de persistir — AC 1.2)
- [x] Excepción tipada `InsufficientEvidenceError` (`research.errors.ts`, coding-rules.md §5) cuando hay <3 fuentes válidas con hash distinto — no se persiste `ResearchSession` si esto pasa
- [x] Servicio de extracción de `EvidenceFact` usando `ResearchOutputSchema` (`generateObject`, ya definido en contracts) — usa provider `GOOGLE` hardcodeado (única key requerida garantizada hoy, ver decisión 2026-09-07); revisar si `EpisodesModule` termina necesitando elegir el provider de research por episodio
- [x] Tests unitarios con LLM/proveedor de búsqueda mockeado (coding-rules.md §9): `research.service.spec.ts` (7 tests — dedup, `InsufficientEvidenceError`, extracción y persistencia de `EvidenceFact`, agotamiento de reintentos) + `tavily.provider.spec.ts` (2 tests, `fetch` mockeado — request shape con Bearer auth, agotamiento de reintentos ante status no-ok)

**⚠️ Pendiente de revisión del usuario** (decisión no obvia, análoga a las de `AgentsModule` — validar antes de construir `EpisodesModule`):
- `ResearchService.research(topicId: string)` toma el id de un `Topic` ya persistido, no el string del tema directo — porque `ResearchSession.topicId` es obligatorio en `schema.prisma` y `Topic` le pertenece a este módulo (architecture.md §6). Se agregó `ResearchService.createTopic(title, context)` aparte. Todavía no está definido quién llama a `createTopic()` y en qué paso exacto del pipeline (`EpisodesModule` no existe aún) — asumido que será el orquestador al recibir el tema del usuario, antes de `runResearch()`.

## 2. Agents (`modules/agents/`) — COMPLETA (código + revisión de diseño + tests)

Entidad: `Agent`. Implementa `DebateAgent` (contrato ya definido).

- [x] Módulo (`agents.module.ts` + `agents.service.ts`, sin controller — coding-rules.md §1)
- [x] Implementación de `DebateAgent.argue()` (OPENING/REBUTTAL) con `generateObject` + `ArgumentDraftSchema`
- [x] Implementación de `DebateAgent.respond()` (CROSS_EXAMINATION) con `CrossExaminationDraftSchema`
- [x] Implementación de `DebateAgent.amend()` (loop de enmienda, recibe `AmendmentFeedback`)
- [x] Wiring de `buildDebaterSystemPrompt` / `buildJudgeSystemPrompt` al armar el prompt real
- [x] Política Cockatiel alrededor de las llamadas a LLM (coding-rules.md §4) — `.parse()` de Zod **dentro** del bloque reintentado
- [x] Seed de los 4 `Agent` (Analyst/Contrarian/Diplomat/Provocateur) + 1 `Agent` Judge en la base (`prisma/seed.ts`, wireado en `prisma.config.ts` → `migrations.seed`; correr con `npm run db:seed`. Verificado idempotente — dos corridas seguidas dejan 5 filas, no duplica, vía `findFirst`+`create`/`update` porque `Agent.name` no tiene `@unique` en el schema)
- [x] Tests unitarios con LLM mockeado (`agents.service.spec.ts`, 7 tests) — `generateObject` de `ai` mockeado en el borde del SDK (jest-testing skill), `ModelProviderFactory` mockeado vía `TestingModule`. Cubre: wiring de `createDebateAgent` con el provider, `argue`/`respond`/`amend` (las dos ramas de schema) y `judge` en el happy path (system prompt correcto por persona/roundType, prompt con los datos esperados), y un caso de resiliencia (Cockatiel agota reintentos y rechaza cuando el output nunca matchea el schema — `maxAttempts: 3` = 4 invocaciones totales, 1 inicial + 3 reintentos)
  - Nota de diseño para el próximo módulo que agregue tests: la `policy` de Cockatiel es una instancia a nivel de módulo (no exportada, no reseteable) compartida por todos los tests del archivo — un test que fuerza fallos consume el contador del `ConsecutiveBreaker`. Con un solo test de fallo al final del archivo no llega a abrir el circuito (4 de 5), pero si se agregan más casos de fallo hay que vigilar el orden o resetear el módulo entre tests (`jest.resetModules()`)
  - Fix de infraestructura necesario para que corrieran: `cockatiel` también se publica solo como ESM (mismo problema que `@nestjs/config`, tasks.md línea 26) — se agregó a `transformIgnorePatterns` en `package.json` y `test/jest-e2e.json`
  - **Bug real encontrado corriendo el e2e** (no relacionado a los tests nuevos en sí): `AiModule` (`modules/ai/ai.module.ts`) tenía el comentario "Global, igual que PrismaModule" pero le faltaba el decorador `@Global()` — `AgentsService` no podía resolver `ModelProviderFactory` al bootstrapear `AppModule` completo (`test/app.e2e-spec.ts` fallaba con `Nest can't resolve dependencies of the AgentsService`). Corregido agregando `@Global()`.

**⚠️ PENDIENTE DE REVISIÓN DEL USUARIO — decisiones de diseño no obvias tomadas al implementar (2026-09-07)**, no pedidas explícitamente palabra por palabra en el checklist original, quedan a validar en la próxima sesión antes de seguir con Fase 1 (Research):
- [x] **Revisado 2026-09-08**: `research()` se sacó por completo del contrato `DebateAgent` (`shared/contracts/agents.contracts.ts`) — no era un `Omit` parcial, se eliminó la firma. Motivo (architecture.md §4/§7.1): `EpisodesModule.runResearch()` llama a `ResearchModule.research(topic)` **una sola vez por episodio**, antes de que arranque el loop de rondas, y arma la Evidence Base que después viaja dentro de `DebateContext.evidenceBase` a cada `argue()`/`respond()`/`amend()`. Ningún `DebateAgent` busca evidencia nueva durante el debate — solo la lee. Fact-check (`FactCheckModule`) es un rol aparte: no busca evidencia, contrasta lo que el agente ya escribió contra la Evidence Base ya obtenida. `AgentsModule.DebaterAgent` ahora es simplemente `= DebateAgent` (ya no hace falta `Omit`).
- [ ] **Pendiente real, no resuelto todavía**: `ResearchModule` no existe (sección 1 de este archivo). Cuando se implemente, definir ahí la firma equivalente — probablemente `ResearchService.research(topic: string): Promise<ResearchOutput>` — reusando `ResearchOutputSchema` ya definido en `agents.contracts.ts`.
- [x] **Revisado 2026-09-08**: `DebateAgent.argue()`/`.amend()` ahora reciben `roundType` como parámetro explícito (`agents.contracts.ts`: `argue(context, roundType: "OPENING" | "REBUTTAL")`, `amend(context, original, feedback, roundType: RoundType)`). Se descartó el patrón factory-por-turno original (`createDebateAgent(persona, provider, roundType)` fabricando una instancia nueva en cada turno) porque `DebaterAgentImpl` no tiene estado/memoria entre llamadas — todo lo que varía turno a turno ya viaja en `DebateContext` por parámetro — así que crear una instancia nueva por turno solo para cerrar sobre `roundType` era innecesario. Ahora `AgentsService.createDebateAgent(persona, provider)` crea **una sola instancia por `EpisodeParticipant`**, reusada en todos sus turnos durante el loop de rondas (architecture.md §7.2); el futuro `EpisodesModule` la crea una vez al armar los participantes (§7.1), no dentro del loop.
- [x] **Revisado y aprobado 2026-09-08, sin cambios**: `AgentsService.judge(context, provider)` (no estaba explícito en el checklist original, pero sí mencionado como wiring de `buildJudgeSystemPrompt`): usa `VerdictOutputSchema`, corresponde a architecture.md §7.4. Judge no es un `DebaterPersona` ni sigue el ciclo argue/respond/amend, así que vive como método aparte en el service en vez de en `DebaterAgentImpl`.
- [x] **Resuelto 2026-09-08**: `Agent.name` ahora tiene `@unique` en `schema.prisma`, con migración `prisma/migrations/20260908100801_agent_name_unique/` (`CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name")`) aplicada a `dev.db` y Prisma Client regenerado. No había duplicados en los 5 registros existentes (Analyst/Contrarian/Diplomat/Provocateur/Judge). El seed (`prisma/seed.ts`) sigue resolviendo idempotencia a mano con `findFirst`+`create`/`update` — ahora que hay constraint de DB, se podría simplificar a `prisma.agent.upsert({ where: { name }, ... })`, pero no se tocó (no era parte de este pedido puntual).

## 3. Debate (`modules/debate/`) — COMPLETA (código + tests)

Entidades: `Debate`, `DebateRound`, `Argument`, `ArgumentHistory`, `Verdict`.

- [x] Módulo (`debate.module.ts` + `debate.service.ts` + spec, sin controller — mismo criterio que Agents/Research, lo orquesta `EpisodesModule`). Sin política Cockatiel: no llama a ningún servicio externo, solo Prisma
- [x] `createDebate(topicId)` + Creación de `DebateRound` tipada por `RoundType` (`createRound`)
- [x] `createDraftArgument` (no itemizado explícito en el checklist original pero necesario como base — deja status/origin sin setear, confía en los `@default` de `schema.prisma`) + Promoción de `Argument` DRAFT → OFFICIAL (`promoteToOfficial`) + `rejectArgument` (terminal, la llama `EpisodesModule` cuando `procesarBorrador` agota `maxRevisionAttempts`, architecture.md §7.3)
- [x] Selección aleatoria de `respondsToId` en CROSS_EXAMINATION (`pickCrossExaminationTarget`, arquitectura §7.2 — evitar repetir target si hay más de uno disponible; si ya fueron todos targeteados, repite alguno)
- [x] Trazabilidad de mutación (Feature 5): **dos métodos separados** en vez de uno genérico con flag — `reviseDraft` (loop de enmienda por fact-check fallido → `ArgumentHistory.status = REJECTED`, mismo origin) y `editByHuman` (edición editorial post-hoc → `ArgumentHistory.status = SUPERSEDED` + `Argument.origin → HUMAN_EDITED`)
- [x] Persistencia de `Verdict` vía `VerdictOutputSchema` (`createVerdict`, mapea `winnerAgentId` → `winnerId`)
- [x] Tests unitarios (`debate.service.spec.ts`, 12 tests) — Prisma mockeado, sin LLM/servicio externo de por medio

**⚠️ Pendiente de revisión del usuario** (decisiones de diseño no obvias, mismo patrón que Agents/Research — validar antes de construir `EpisodesModule`):
- [x] **Resuelto 2026-09-08**: confirmado por el usuario — el diagrama de architecture.md §3 (`DebateModule` con `AgentsModule`/`FactCheckModule` "debajo") estaba desactualizado de una versión anterior, de cuando la orquestación se revisaba a mano y todavía no estaba definida en detalle. `EpisodesModule` es quien coordina los tres módulos por separado; `DebateModule` no importa ni `AgentsModule` ni `FactCheckModule`, como ya estaba implementado. Diagrama corregido en architecture.md §3 (los 6 módulos de dominio cuelgan directo de `EpisodesModule`, sin jerarquía intermedia).
- [x] **Resuelto 2026-09-08**: `pickCrossExaminationTarget` tira `NoCrossExaminationTargetError` (excepción tipada, `debate.errors.ts`) si el oponente no tiene ningún `Argument` OFFICIAL — se descartó la idea inicial de dejarlo como `Error` genérico al encontrar un caso concreto y alcanzable en operación normal (no solo un bug de orquestación): un curador puede resolver un `MAX_REVISIONS_EXCEEDED` con la acción `reject` en vez de arreglar el draft, dejando a ese agente sin ningún argumento OFFICIAL para cuando arranca CROSS_EXAMINATION. Mapea a `CheckpointReason.VALIDATION_INCONSISTENCY`, que ya existía en el schema para exactamente este tipo de caso ("inconsistencia en validación intermedia que no rompe el backend pero requiere árbitro humano", features.md Feature 4) — no hizo falta agregar un reason nuevo. Ver `frontend-notes.md` (entrada 2026-09-08) para el flujo de resolución propuesto (acción `regenerate`) y su impacto en la UI, todavía no implementado.

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
  - [ ] Capturar `NoCrossExaminationTargetError` de `DebateModule.pickCrossExaminationTarget` → `EpisodeCheckpoint` con `reason: VALIDATION_INCONSISTENCY` → `Episode → REQUIRES_HUMAN_REVIEW` → resolución esperada vía acción `regenerate` (ver `frontend-notes.md` 2026-09-08, decisión tomada 2026-09-08 sección 3 de este archivo)
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
