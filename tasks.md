# Tasks — AI Trend Debates

Tracking del estado de implementación. No repite el diseño (eso vive en `architecture.md` / `features.md` / `api-contract.md` / `coding-rules.md`) — solo lista qué está hecho y qué falta, módulo por módulo, para saber en qué seguir sin releer todo el proyecto.

Convención: `[x]` hecho, `[ ]` pendiente, `[~]` empezado/parcial. Última revisión: 2026-09-08.

## Dónde retomar (última sesión: 2026-09-08)

**Completo y verificado**: secciones 0-4 (Fundacional, Research, Agents, Debate, Fact-check), 0.1 (rate limiter), 7 (Episodes — el orquestador completo), 8 (SSE), y el ítem de formato de error de la 9 — código + tests unitarios/integración + `tsc` limpio en todo el repo (121 tests unitarios + 1 e2e, todo en verde). Además, `scripts/smoke-test-argument.ts` corrió de punta a punta **contra APIs reales** (Tavily + Gemini) antes de construir `EpisodesModule`, probando que el tramo research → argumento anda de verdad, no solo con mocks.

**No hay nada roto ni a medio terminar** — el repo compila, todos los tests pasan. El módulo más grande y central del proyecto (`EpisodesModule`, el orquestador) ya está completo, incluyendo notificaciones internas, SSE, resume/recovery, y tests de integración multi-módulo. Se encontraron y corrigieron 3 bugs reales en revisión manual durante la construcción (`decision-log.md` entrada 10), y un cuarto corriendo `scripts/smoke-test-episode.ts` (nuevo) contra APIs reales — el rechazo reiterado del filtro editorial por falta de contexto, corregido en `FactCheckModule.editorialReview` (entradas 11 y 12).

Lo que sigue:

- **`TTS`** (sección 5) o **`Render`** (sección 6, P1 — no bloquea el MVP) — los dos módulos de dominio que faltan. Ninguno tiene código todavía.
- Ahora que existe una superficie HTTP real (`POST /episodes`, `GET /episodes`, etc.), es un buen momento para retomar el **scaffolding de frontend** que se había pausado a propósito hasta tener este recorte vertical.
- Pendiente aparte, no bloqueante: completar `README.md` (sigue siendo boilerplate de NestJS).
- **Pendiente real, no bloqueante**: en una revisión rechazada del smoke test, el agente citó un `sourceId` interno crudo en el texto visible del argumento ("la fuente 40267180-... señala que..."). `formatEvidence()`/`buildArguePrompt` en `agents.service.ts` (sección 2) no le aclaran al modelo que no debe repetir ese identificador interno en su respuesta — problema de calidad de prompt, no causó ningún bug funcional esta vez, pero vale la pena revisarlo. Ver `decision-log.md` entrada 12.
- Recomendado antes de seguir: volver a correr `npm run smoke:episode` (con las rondas completas esta vez, no recortadas) para confirmar que el fix del filtro editorial realmente reduce el loop de enmienda en la práctica — no se re-verificó contra la API real todavía, solo se corrigió el código y se confirmó con `tsc`/tests unitarios (que no podían haber capturado este bug en primer lugar, por eso hizo falta la corrida real).

**Nuevo esta sesión**: se creó `decision-log.md` — bitácora cronológica de decisiones no obvias (con el proceso de cómo se llegó a cada una), pensada como insumo para un paper que el usuario está planeando escribir sobre el desarrollo de este proyecto. Se implementaron en esta misma sesión: el rate limiter proactivo de LLM (0.1), el sistema de notificaciones internas, `EpisodesModule` completo, y el fix del filtro editorial — ver `decision-log.md` entradas 8 a 12. Se agregó también `scripts/smoke-test-episode.ts` (`npm run smoke:episode`), mismo criterio que `scripts/smoke-test-argument.ts` pero corriendo el pipeline completo de `EpisodesModule`.

## 0. Fundacional (bloquea todo lo demás) — COMPLETA

- [x] `schema.prisma` completo (todas las entidades y enums de `architecture.md` sección 6)
- [x] Migraciones iniciales aplicadas (`prisma/migrations/`)
- [x] `shared/config/env.schema.ts` (Zod) + `validateEnv`
- [x] `shared/contracts/agents.contracts.ts` (schemas Zod + `DebateAgent` + `DebateContext`)
- [x] `shared/personas/agents.personas.ts` (4 personas debatientes + Judge + builders de system prompt)
- [x] `modules/ai/` — `ModelProviderFactory` (5 providers resueltos: OPENAI, GOOGLE, ANTHROPIC, XAI, OPENROUTER)
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
- [x] **Habilitado `OPENROUTER` en `ModelProviderFactory`** (2026-09-08, `@openrouter/ai-sdk-provider@2.10.0` — versión `2.x`, no la `3.x`/`6.x-alpha` más nuevas, que ya piden `ai@^7` y este proyecto está en `ai@^6`). De los 5 modelos `:free` de OpenRouter que declaran soporte de `structured_outputs`, se validaron 3 a mano contra la API real con `scripts/validate-openrouter-models.ts` — 2 funcionan de verdad (`nvidia/nemotron-3-super-120b-a12b:free`, `liquid/lfm-2.5-2.6b:free`), 1 es funcional pero con capacidad gratuita compartida demasiado inestable (`nex-agi/nex-n2.5-pro:free`, falló 2 de 3 veces con "rate-limited upstream"). `resolve('OPENROUTER')` sortea entre los 2 validados en cada llamada — un solo `ModelProvider.OPENROUTER` (no dos valores de enum), porque ambos modelos comparten la misma cuenta/key y por lo tanto el mismo cupo real de RPM/RPD; separarlos en dos providers hubiera hecho que `LlmRateLimiterService` subestimara el uso real. `OPENROUTER_RPM_LIMIT`/`OPENROUTER_RPD_LIMIT` nuevos en `env.schema.ts` (default 20/50, el caso conservador del free tier real). Proceso completo (investigación + validación + la decisión del enum) en `decision-log.md` entrada 13.
- [x] Fix de infraestructura de tests, necesario para que `test/app.e2e-spec.ts` (bootstrapea `AppModule` completo) no rompiera al agregar `ConfigModule`: `@nestjs/config@12` se publica solo como ESM (`"type": "module"`, sin build CJS) — Node lo resuelve en runtime real vía `require(esm)` (soportado desde Node 22.12+), pero Jest no. Se agregó `transformIgnorePatterns` en `package.json` (jest unitario) y `test/jest-e2e.json` para que `ts-jest` transpile ese paquete en vez de ignorarlo. Además se agregó `test/jest-e2e.setup.ts` con un `GOOGLE_API_KEY` dummy para que los tests e2e no dependan de una key real.

**Decisión del usuario (2026-09-07) sobre validación de env vars de LLM**: solo `GOOGLE_API_KEY` es requerida (única con acceso gratuito hoy). `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` y `XAI_API_KEY` quedan `.optional()` en `env.schema.ts` — el proceso arranca sin ellas, y `ModelProviderFactory.resolve()` recién falla si algo intenta usar un provider sin key configurada. Revisar este criterio cuando se contrate una suscripción adecuada a los demás providers.

- [x] **`scripts/smoke-test-argument.ts`** (2026-09-08, no automatizado — no es un `*.spec.ts`, corre contra APIs reales y gasta créditos): encadena `ResearchModule` → `DebateModule` → `AgentsModule` con Tavily + Gemini reales para validar el tramo "research → primer argumento OPENING" antes de que exista `EpisodesModule`. A propósito no pasa por `FactCheckModule` todavía. Correr con `npm run smoke:argument` (requiere `GOOGLE_API_KEY`/`TAVILY_API_KEY` reales en `.env`).
  - **Bug real encontrado y corregido corriendo el smoke test contra la API real**: el modelo hardcodeado en `ModelProviderFactory` para GOOGLE, `gemini-2.0-flash`, fue dado de baja por Google (404 "no longer available"). Se probó `gemini-2.5-flash` (también 404, "no longer available to new users") y `gemini-3.6-flash` (funcionó — confirmado end-to-end con research real de 9 facts + argumento OPENING generado y persistido como OFFICIAL). Revisando el dashboard de rate limits de AI Studio con el usuario se vio que TODOS los "Flash" normales de cualquier generación (3/3.5/3.6/3.7/3.8) están topeados igual en este free tier — 5 RPM / 20 RPD — mientras que las variantes "Flash Lite" tienen 15 RPM / 500 RPD. Se cambió el modelo final a **`gemini-3.5-flash-lite`** (la Lite más reciente disponible) para tener margen real de desarrollo, a cambio de algo menos de calidad/razonamiento — aceptable para este caso de uso.
  - Evaluado y descartado: "Gemini 3 Flash Live" (aparece con RPM/RPD "ilimitado" en el dashboard) — es un producto distinto, la Live API (WebSocket, voz/video en tiempo real), no compatible con `generateContent`/`generateObject` de structured output que usamos.

## 0.1. Rate limiting proactivo de llamadas a LLM (`modules/ai/`) — COMPLETA (código + tests, 2026-09-08)

Motivado por el free tier ajustado de Google (15 RPM / 500 RPD en `gemini-3.5-flash-lite`, ver sección 0) y porque ese límite es por API key, no por módulo — `ResearchModule`/`AgentsModule`/`FactCheckModule` comparten el mismo cupo aunque cada uno tenga su propia policy de Cockatiel. Diseño completo con el proceso de cómo se llegó a cada decisión en `decision-log.md` entrada 8.

- [x] `prisma/schema.prisma`: tabla `LlmRequestLog` (`provider`, `requestedAt`, índice `[provider, requestedAt]`) + `CheckpointReason.PROVIDER_QUOTA_EXCEEDED` nuevo (distinto de `USAGE_LIMIT_EXCEEDED` — ese es presupuesto propio del episodio, este es cuota del provider). Migración `prisma/migrations/20260908190551_add_llm_rate_limiting/` aplicada, cliente regenerado
- [x] `env.schema.ts`: `GOOGLE_RPM_LIMIT`/`GOOGLE_RPD_LIMIT` opcionales (`z.coerce.number()`), default 15/500. Sincronizado `.env.example`
- [x] `modules/ai/ai.errors.ts`: `DailyQuotaExceededError` (mismo patrón que `InsufficientEvidenceError`) + `RateLimitWaitExceededError` (nueva, no estaba en el checklist original — cap defensivo de espera de RPM superado, señal de bug/límite mal configurado, no un caso esperado)
- [x] `modules/ai/llm-rate-limiter.service.ts`: `acquire(provider): Promise<void>` — RPD (ventana deslizante 24hs) se chequea primero y falla rápido con `DailyQuotaExceededError`; RPM (ventana deslizante 60s) encola y espera con cap defensivo de 90s (`RateLimitWaitExceededError` si se supera). Mapa `PROVIDER_RATE_LIMITS` en código: solo GOOGLE configurado (lee de `ConfigService`), resto `null` (no-op, solo loguea la fila por observabilidad, sin chequeo de cupo)
- [x] Mutex en memoria por `ModelProvider` (`Map<ModelProvider, Promise<void>>` con promesas encadenadas, sin dependencia nueva) para la sección crítica de `acquire()`
- [x] Wiring en los 3 call sites existentes — `acquire(provider)` llamado dentro del bloque reintentado por Cockatiel, antes de `generateObject`, en `agents.service.ts` (los 4 puntos: `argue`/`respond`/`amend` de `DebaterAgentImpl` + `judge`), `research.service.ts` y `fact-check.service.ts` (los 3 métodos)
- [x] `handleAll` → `handleWhen((err) => !(err instanceof DailyQuotaExceededError))` en las 3 policies de Cockatiel existentes — aplicado tanto al `retry` como al `circuitBreaker` de cada una, por consistencia
- [x] Poda oportunista de `LlmRequestLog` (filas > 48hs) al final de `acquireLocked()` — no aplica al camino no-op (providers sin límite configurado)
- [x] Tests: `llm-rate-limiter.service.spec.ts` nuevo (5 casos: no-op sin límite, pasa debajo del límite, `DailyQuotaExceededError` sin esperar, espera con `jest.useFakeTimers()`/`advanceTimersByTimeAsync` cuando RPM está al tope, mutex serializa llamadas concurrentes) + ajuste de los 3 specs existentes (mock de `LlmRateLimiterService` como no-op). `npx tsc --noEmit` limpio, `npm test` (35/35) y `npm run test:e2e` (1/1, `AppModule` completo sigue bootstrapeando con el wiring nuevo) verdes

## 1. Research (`modules/research/`) — COMPLETA (código + tests + verificado con API real, 2026-09-08)

Entidades: `Topic`, `ResearchSession`, `Source`, `EvidenceFact`.

- [x] Módulo (`research.module.ts` + `research.service.ts` + `tavily.provider.ts` + `research.errors.ts` + specs, sin controller — coding-rules.md §1, mismo criterio que `AgentsModule`: lo orquesta `EpisodesModule`, que todavía no existe)
- [x] **Proveedor de búsqueda web decidido: Tavily** (investigado 2026-09-08 — free tier 1000 créditos/mes sin tarjeta, pensado para agentes LLM, encaja con `Source.title`/`url`/`snippet`). `TAVILY_API_KEY` agregada como **requerida** en `env.schema.ts`/`.env.example` (a diferencia de OPENAI/ANTHROPIC/XAI que son opcionales — Research es P0, no tiene sentido arrancar sin poder ejecutar una research real)
  - [x] **Resuelto 2026-09-08**: el usuario generó `GOOGLE_API_KEY`/`TAVILY_API_KEY` reales y las completó en `.env` — verificado funcionando con `scripts/smoke-test-argument.ts` (ver sección 0).
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

## 4. Fact-check (`modules/fact-check/`) — COMPLETA (código + tests)

Entidades: `Claim`, `FactCheck`.

- [x] Módulo (`fact-check.module.ts` + `fact-check.service.ts` + spec, sin controller — mismo criterio que Agents/Research/Debate). Una sola política Cockatiel para los tres métodos (misma clase de integración — generateObject —, igual criterio que AgentsModule)
- [x] Claim extraction (`ClaimExtractionOutputSchema`, ya definido) — segmentar DRAFT en `FACTUAL`/`OPINION`/`PREDICTION`/`SUBJECTIVE` (`extractClaims`, persiste cada `Claim`)
- [x] Fact-checking estricto de claims `FACTUAL` contra la Evidence Base (`FactCheckOutputSchema`) — trazabilidad obligatoria a `sourceIds` (AC 1.2) (`check`, persiste `FactCheck` conectado a `Claim` y a las `Source` citadas — incluso si el resultado es FALSE, queda auditado)
- [x] Filtro editorial para claims no factuales (`EditorialReviewOutputSchema`) usando `persona.editorialRules` (`editorialReview` — no persiste nada, el schema no tiene tabla para esto, el orquestador reacciona directo al resultado)
- [x] Tests unitarios (`fact-check.service.spec.ts`, 5 tests)

**Cambio posterior (2026-09-08, corriendo `EpisodesModule` contra APIs reales)**: `editorialReview(claim, persona, provider, argumentContent)` — se agregó `argumentContent` (contenido completo del argumento, no solo el claim aislado) como parámetro requerido. Bug real encontrado con `scripts/smoke-test-episode.ts`: evaluar un claim `OPINION`/`SUBJECTIVE` sin el argumento completo alrededor rechazaba afirmaciones bien respaldadas por datos que vivían en una oración vecina del mismo argumento — disparaba el loop de enmienda innecesariamente hasta agotar el presupuesto de LLM del episodio. Proceso completo y diagnóstico en `decision-log.md` entradas 11 y 12.

**Segundo cambio posterior (2026-09-08, tras sumar `OPENROUTER`)**: `EditorialReviewOutputSchema` es el único de los 7 schemas de `generateObject` del proyecto con un `.refine()` condicional — un modelo `:free` de OpenRouter no logró cumplirlo de forma confiable (`AI_NoObjectGeneratedError` tras agotar reintentos). `episode-orchestrator.service.ts` ahora fuerza `GOOGLE` (`EDITORIAL_REVIEW_PROVIDER`) para esta llamada puntual, sea cual sea el provider real del debatiente — mismo criterio que `EXTRACTION_PROVIDER` en `research.service.ts`. El resto de las llamadas del mismo argumento siguen usando el provider real. Proceso completo (incluidas las opciones descartadas) en `decision-log.md` entrada 14.

**⚠️ Dos ítems del checklist original que, al revisarlos, no le corresponden a este módulo** (mismo patrón que otras sesiones — encontrado al implementar, marcado para que lo confirmes):
- **"Paralelización de fact-checking agrupada por ModelProvider"**: `check()`/`editorialReview()` acá son de a un claim por vez, con el `provider` como parámetro explícito (a diferencia de Research, donde quedó hardcodeado — acá el futuro orquestador ya sabe qué provider usar por claim). La lógica de "disparar muchas llamadas en paralelo sin pisar el rate limit de un mismo provider" es coordinación entre MUCHAS llamadas simultáneas — eso es trabajo de `EpisodesModule.procesarBorrador` (arquitectura §7.3, ya trackeado en la sección 7 de este archivo), no algo que `FactCheckModule` pueda hacer por sí solo llamando de a un claim genérico.
- **"Excepción tipada para MAX_REVISIONS_EXCEEDED"**: por el mismo motivo que ya establecimos con `DebateModule.rejectArgument()` (sección 3) — el conteo de intentos contra `episode.maxRevisionAttempts` necesita el dato de `Episode`, que `FactCheckModule` no conoce (coding-rules.md §5: "Ningún otro módulo conoce EpisodeStatus ni CheckpointReason"). No tiene sentido que `FactCheckModule` tire esa excepción si nunca ve el contador — es `EpisodesModule` quien cuenta los intentos en su propio loop y decide la transición directo, sin necesitar capturar nada de acá. No se implementó.

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

## 7. Episodes — el orquestador (`modules/episodes/`) — COMPLETA (código + tests + integración, 2026-09-08)

Entidades: `Episode`, `EpisodeParticipant`, `EpisodeUsage`, `EpisodeCheckpoint`. Único módulo que conoce el pipeline completo y el único que escribe `Episode.status`. Construido en 5 fases verificables (plan completo, diseñado con el agente de arquitectura + un agente de planificación, en `decision-log.md` entrada 10), cada una con `tsc`/tests en verde antes de pasar a la siguiente.

- [x] `EpisodeStateService` (coding-rules.md §6) — único escritor de `Episode.status`. Un método por **estado destino** (no por arista from→to), cada uno valida un `ALLOWED_FROM` de orígenes permitidos — reusa el mismo método en flujo normal y en resume. `requireHumanReview(reason)` detecta "la misma causa volvió a ocurrir tras un resume" comparando contra el `EpisodeCheckpoint` más reciente, y escala directo a `markFailed` si coincide (sin pasar por otro `REQUIRES_HUMAN_REVIEW` intermedio). No implementa `markGeneratingAudio`/`markReadyForRender`/`markRendering`/`markCompleted` todavía (TTS/Render no existen — YAGNI documentado, se agregan después con el mismo patrón).
- [x] Selección de participantes al crear el episodio (arquitectura §7.1 — `EpisodeParticipantsService`: 2 de 4 personas + Judge con provider distinto + sorteo de orden de turnos). Providers "disponibles" para el sorteo se resuelven con un chequeo propio de env vars en este service (sin tocar `ModelProviderFactory`, fuera de scope). Fallback documentado cuando solo hay 1 provider configurado (caso real hoy, solo GOOGLE): el Judge sortea entre todos igual.
- [x] Loop de rondas OPENING → REBUTTAL → CROSS_EXAMINATION (arquitectura §7.2, `EpisodeOrchestratorService.runDebatePhase`/`runRound`). Orden de turnos derivado sin columna nueva en `EpisodeParticipant` (D-4 del plan): se fija por el `createdAt` del primer `Argument` de la ronda OPENING/1, resortea si todavía no hay ninguno — resistente a resume/recovery sin necesitar un cursor persistido.
  - [x] `NoCrossExaminationTargetError` de `DebateModule.pickCrossExaminationTarget` → `EpisodeCheckpoint` con `reason: VALIDATION_INCONSISTENCY` → `REQUIRES_HUMAN_REVIEW` (mapeado en `handlePipelineError`, resolución vía `regenerate` como ya estaba previsto)
- [x] `procesarBorrador` — `EpisodeOrchestratorService.processDraft` (arquitectura §7.3): claim extraction + fact-check/editorial + loop de enmienda.
  - [x] **Decisión D-7 del plan**: NO se agrupan manualmente las llamadas de fact-check por `ModelProvider` — `Promise.all` sobre todos los claims. `LlmRateLimiterService.acquire()` (sección 0.1) ya serializa correctamente por provider vía su mutex interno; agrupar en el orquestador hubiera duplicado esa garantía. Reemplaza la idea original de "cola por provider" de esta misma sección.
  - [x] Conteo de `intentos` contra `episode.maxRevisionAttempts` → al agotarse, `DebateService.rejectArgument` + `EpisodeStateService.requireHumanReview(reason: MAX_REVISIONS_EXCEEDED)`, señalizado con `EpisodePipelineHaltedError` (excepción de control interna, para que `handlePipelineError` no la vuelva a mapear)
- [x] Chequeo de presupuesto (`EpisodeBudgetService.withLlmCall`/`withSearchRequest` — `EpisodeUsage` vs `maxLlmCalls`/`maxSearchQueries`) antes de cada llamada externa (AC 2.1). Envuelve **todas** las llamadas a LLM del pipeline, incluida `regenerate()` en curaduría (gap encontrado y corregido en revisión — no estaba en el plan original, `AC 2.1` no distingue entre pipeline automático y acciones humanas). `maxTtsSegments` queda sin uso todavía (TTS no existe).
  - **Bug de concurrencia real, encontrado y corregido (2026-09-08)**: el chequeo original ("leer contador → chequear → incrementar") tenía una condición de carrera bajo el `Promise.all` de `processDraft` (varios claims verificados en paralelo) — `EpisodeUsage.llmCalls` llegó a 38 con `maxLlmCalls: 25` configurado. Reemplazado por un `UPDATE` atómico (`updateMany` con `WHERE metric < limit`, sin mutex en memoria — a diferencia del rate limiter, acá el chequeo sí se puede expresar en un único `UPDATE` condicional). Proceso completo en `decision-log.md` entrada 15.
- [x] Persistencia de `EpisodeCheckpoint` como historial (nunca se pisa) al entrar a `REQUIRES_HUMAN_REVIEW`/`FAILED`, con `snapshot: JSON.stringify(EpisodeUsage)`
- [x] Lógica de `Resume` (`EpisodeActionsService.resume` + `EpisodeStateService.resumeFromCheckpoint`, retoma desde `checkpoint.fromState`/`debateRoundId`) y escalado a `FAILED` si la misma causa se repite tras un resume (ver `requireHumanReview` arriba)
- [x] Idempotencia post-caída del proceso (`EpisodeRecoveryService.onApplicationBootstrap`, Feature 4) — retoma episodios en `RESEARCHING`/`DEBATING`/`JUDGING` al reiniciar, reusando la misma idempotencia por re-chequeo de cada fase que ya usan la corrida inicial y el resume manual (sin lógica de recovery separada). `GENERATING_AUDIO`/`RENDERING` fuera del alcance a propósito.
- [x] `episodes.controller.ts`:
  - [x] `POST /episodes`
  - [x] `GET /episodes` (filtrable por `status`)
  - [x] `GET /episodes/:id`
  - [ ] `GET /episodes/:id/audio/:audioAssetId/url` — **fuera de scope a propósito**, depende de `TTSModule` (no existe)
  - [x] `POST /episodes/:id/actions/approve`
  - [x] `POST /episodes/:id/actions/edit`
  - [x] `POST /episodes/:id/actions/regenerate` — reescritura editorial vía `reviseDraft` (no `editByHuman`: el contenido lo sigue generando el agente, `origin` queda `AI_GENERATED`), sin pasar por el loop de fact-check
  - [x] `POST /episodes/:id/actions/reject`
  - [x] `POST /episodes/:id/actions/resume` — body validado contra el `reason` real del checkpoint activo (no solo contra la unión de los 3 shapes posibles)
  - [x] Validar tabla de estados válidos por acción (api-contract.md §5) → `409 Conflict` con `code: INVALID_STATE_TRANSITION` (vía `HttpErrorFilter` global — resuelve de paso el pendiente de formato de error de la sección 9)
  - [x] `GET /episodes/:id/events` (SSE) — ver sección 8
  - [ ] `GET /episodes/:id/manifest` — **fuera de scope a propósito**, depende de `RenderModule` (P1, no existe)
- [x] DTOs Zod separados de los contratos de agentes (`modules/episodes/dto/`, coding-rules.md §3) + `ZodValidationPipe` genérico (`shared/http/`)
- [x] Tests de integración orquestando varios módulos con todo mockeado en el borde externo (coding-rules.md §9 — `episodes.integration.spec.ts`, contra sqlite de test real aislada de `dev.db`, con `ResearchService`/`AgentsService`/`FactCheckService` mockeados). Cubre pipeline feliz completo, `InsufficientEvidenceError`, `MAX_REVISIONS_EXCEEDED`, resume exitoso, escalada a `FAILED` tras repetir la misma causa, y recovery post-caída — este último ejerce el bug real descrito abajo.

**Notificaciones internas** — implementadas junto con `EpisodeStateService`, como estaba planeado (`decision-log.md` entrada 9): tabla `Notification`/`enum NotificationType` (`EPISODE_COMPLETED`/`EPISODE_PENDING_REVIEW`/`EPISODE_REQUIRES_REVIEW`/`EPISODE_FAILED`) acoplada 1:1 a `Episode`, `modules/notifications/` standalone con su controller (`GET /notifications?unreadOnly=true`, `POST /notifications/:id/read`, `POST /notifications/read-all`), `NotificationsService` inyectado en `EpisodeStateService` y disparado como último paso interno de cada transición relevante.

**⚠️ Bug real encontrado en revisión manual (no por los tests generados) — corregido**: `EpisodeOrchestratorService.runResearchPhase` chequeaba `refreshed.status !== 'READY_FOR_DEBATE'` para decidir si transicionar a `READY_FOR_DEBATE`, en vez de `=== 'RESEARCHING'`. Como `runPipeline()` se reusa tal cual para resume/recovery, un episodio reanudado desde `DEBATING`/`JUDGING` (ej. tras `MAX_REVISIONS_EXCEEDED`) pasaba de nuevo por `runResearchPhase` al llamar `runPipeline`, y ese chequeo intentaba una transición inválida (`DEBATING → READY_FOR_DEBATE`, fuera del `ALLOWED_FROM` real) — rompía el resume antes de llegar a `runDebatePhase`. Corregido con el guard explícito por estado de origen; tiene test de regresión unitario y se ejerce de punta a punta en el escenario de recovery de `episodes.integration.spec.ts`. Ninguna de las fases (A-E) lo detectó por su cuenta — se encontró releyendo el código línea por línea entre fases, no generado por ningún test automático. Ver `decision-log.md` entrada 10 para el detalle completo del proceso de las 5 fases y este hallazgo.

## 8. Real-time (SSE) — COMPLETA (2026-09-08)

- [x] `GET /episodes/:id/events` (`text/event-stream`) — `EpisodeEventsService`, `RxJS Subject` por episodio (`Map<episodeId, Subject<MessageEvent>>`), sin replay/backfill (efímero por diseño, complementario a `Notification`). Se cierra (`complete()`) al terminar cada corrida de `runPipeline`.
- [x] Emisión de los 6 eventos definidos (api-contract.md §4): `research.started`, `agent.thinking`, `fact_check.completed`, `argument.approved` (todos emitidos desde `EpisodeOrchestratorService`), `episode.pending_review`/`episode.requires_review` (emitidos desde `EpisodeStateService` — **gap encontrado en revisión y corregido**: `EpisodeEventsService` se construyó en una fase posterior a `EpisodeStateService` y nadie había vuelto a conectarlos; el contrato prometía estos 2 eventos pero no se emitían)

## 9. Transversal / infraestructura

- [x] Formato de error HTTP consistente `{ "error": { "code": string, "message": string } }` (api-contract.md §1) — `HttpErrorFilter` global (`shared/http/`), registrado en `main.ts`. Resuelto como parte de `EpisodesModule` (primer módulo con superficie HTTP real).
- [x] Seed inicial de datos (`Agent` x5) — ya estaba (`prisma/seed.ts`, sección 2). Config default de `Episode` vive como `@default` en `schema.prisma` (`maxLlmCalls`/`maxSearchQueries`/`maxTtsSegments`/`maxRevisionAttempts`/`openingRounds`/`rebuttalRounds`/`crossExaminationRounds`), no requiere seed aparte.
- [ ] `README.md` sigue siendo el boilerplate default de NestJS — reemplazar por descripción real del proyecto cuando el resto avance
- [ ] `04-development/testing-strategy.md` — mencionado como pendiente en `coding-rules.md` §9, escribir cuando haya al menos un módulo implementado
- [ ] Decidir estrategia de seed/fixtures de `Evidence Base` para desarrollo local (research contra APIs reales cuesta $ — ver límites de Feature 2)

## Referencias

- `architecture.md` — cómo se implementa cada pieza.
- `features.md` — qué hace cada feature y sus criterios de aceptación.
- `api-contract.md` — superficie HTTP completa.
- `coding-rules.md` — convenciones de código a seguir al implementar cada ítem de arriba.
