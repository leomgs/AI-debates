# Arquitectura — AI Trend Debates

Este documento formaliza las decisiones de arquitectura tomadas durante el diseño del backend. No repite el contrato de producto (eso vive en `01-product/features.md`) — se enfoca en **cómo** se implementa, no en **qué** hace cada feature.

## 1. Stack

| Tecnología | Rol |
|---|---|
| NestJS 11 | Framework de API + arquitectura modular + orquestación |
| Prisma 7 | Persistencia (SQLite en desarrollo local) |
| Vercel AI SDK | Abstracción multi-provider de LLMs, structured output |
| OpenRouter | Quinto `ModelProvider` — dos modelos `:free` validados a mano contra la API real (`nvidia/nemotron-3-super-120b-a12b`, `liquid/lfm-2.5-2.6b`), free tier sin tarjeta. Ver `decision-log.md` entrada 13 para el proceso de validación |
| Zod 4 | Contratos de input/output de agentes (`shared/contracts/`) y DTOs HTTP (`modules/episodes/dto/`, `modules/notifications/dto/`, `modules/auth/dto/`) — capas separadas aunque el shape a veces coincida (coding-rules.md §3) |
| Cockatiel | Retry / circuit breaker por integración externa |
| Tavily | Proveedor de búsqueda web para `ResearchModule` (Feature 1) — free tier 1000 créditos/mes sin tarjeta |
| echogarden + Piper / google-tts-api / OpenRouter | 3 proveedores seleccionables vía `AudioProvider` (env var `TTS_PROVIDER`, no por llamada) — **Local (`echogarden`+Piper) implementado y verificado contra el motor real**; Google (`google-tts-api`, ya instalado sin usar) y OpenRouter (`fish-audio/s2.1-pro-free:free`, gateado por validación manual) todavía no implementados (`tasks.md` sección 5, `decision-log.md` entradas 19-22) |
| Jest | Tests unitarios e integración |

## 2. Mapa de módulos

```
src/
  modules/
    research/          ← Feature 1: Topic, ResearchSession, Source, EvidenceFact
    agents/             ← Agent (entidad) + implementaciones de DebateAgent por persona
    debate/             ← Debate, DebateRound, Argument, ArgumentHistory, Verdict
    fact-check/          ← Feature 3: Claim, FactCheck, filtro editorial
    ai/                 ← ModelProviderFactory (mapea ModelProvider -> cliente del AI SDK) +
                           LlmRateLimiterService (gate proactivo de RPM/RPD, LlmRequestLog)
    notifications/       ← Notification/NotificationType — inbox interno consultado por polling,
                           complementario al SSE de episodes/ (no lo reemplaza)
    tts/                ← Feature 6: AudioAsset, 3 AudioProvider seleccionables + AudioStorageProvider
                           (Local implementado y verificado; Google/OpenRouter pendientes — tasks.md sección 5)
    render/             ← Feature 7 (P0, completa): RemotionManifest, RenderService puro.
                           Feature 9 (P1, Asset/worker de Remotion): todavía no existe
    episodes/            ← Feature 2/4/5: Episode, EpisodeParticipant, EpisodeUsage,
                           EpisodeCheckpoint — el orquestador
    auth/                ← Spec 003 API-8 (ADR 0001): login del único curador, sesión por cookie
                           (token HMAC sin estado) y SessionGuard global. Sin tablas propias
  shared/
    prisma/             ← PrismaService, módulo global
    config/              ← env.schema.ts (Zod) + validateEnv, única fuente de verdad de env vars
    contracts/           ← agents.contracts.ts (Zod schemas + DebateAgent + DebateContext)
    personas/            ← agents.personas.ts (4 DebaterPersona + JudgePersona + builders de system prompt)
    http/                ← HttpErrorFilter (formato de error HTTP consistente, api-contract.md §1),
                           buildOpenApiDocument, @Public() y ErrorResponseDto — genéricos, no
                           específicos de episodes (el ZodValidationPipe propio se reemplazó por el
                           de nestjs-zod en la spec 001)
    crypto/              ← Primitivas sin estado de node:crypto: firma HMAC-SHA256 (usada por las URLs
                           de audio de tts/ y por el token de sesión de auth/) y hash scrypt de
                           contraseña (CURATOR_PASSWORD_HASH)
```

Cada módulo de dominio (`research`, `agents`, `debate`, `fact-check`, `tts`, `render`) es responsable de un conjunto de entidades del `schema.prisma` y no conoce a `episodes`. `ai` y `notifications` no son módulos de dominio en ese sentido — `ai` es infraestructura compartida (como `PrismaModule`, marcado `@Global()`) y `notifications` es un módulo standalone con su propio controller HTTP, importado explícitamente por `EpisodesModule` para que `EpisodeStateService` pueda inyectar `NotificationsService`.

## 3. Dirección de dependencias

`EpisodesModule` es el único módulo que conoce el pipeline completo. Todo lo demás es un módulo de dominio que no sabe que `Episode` existe.

```
                                ┌───────────────────┐
                                │   EpisodesModule   │  (orquestador — único que conoce
                                │  (Episode,         │   el pipeline completo)
                                │   EpisodeParticipant,│
                                │   EpisodeUsage,    │
                                │   EpisodeCheckpoint)│
                                └─────────┬─────────┘
        ┌───────────────┬─────────────────┼─────────────────┬───────────────┬─────────────┬─────────────────┐
        ▼                ▼                ▼                 ▼               ▼             ▼                 ▼
  ResearchModule   AgentsModule     DebateModule      FactCheckModule    TtsModule    RenderModule   NotificationsModule
```

`EpisodesModule` llama a los seis módulos de dominio por separado y coordina el flujo entre ellos (ver §7) — ningún módulo de dominio importa a otro. En particular, `DebateModule` no importa `AgentsModule` ni `FactCheckModule`: es persistencia/reglas de negocio puras sobre `Debate`/`DebateRound`/`Argument`/`ArgumentHistory`/`Verdict`, sin llamar a ningún LLM ni proveedor externo.

`AiModule` es distinto de los seis de arriba: es infraestructura global (`@Global()`, mismo criterio que `PrismaModule`) — `ResearchModule`, `AgentsModule` y `FactCheckModule` lo inyectan directo, sin que `EpisodesModule` medie. `NotificationsModule` sí cuelga de `EpisodesModule` en el diagrama porque, a diferencia de `AiModule`, tiene su propio controller HTTP (`GET /notifications`) — es un módulo de aplicación con superficie propia, no infraestructura transversal.

`AuthModule` (spec 003 API-8, ADR 0001) no aparece en el diagrama porque no participa del pipeline: lo importa `AppModule` directamente, no importa ni es importado por ningún otro módulo y no tiene tablas (la credencial vive en el `.env` y la sesión es un token firmado sin estado). Su efecto transversal es el `SessionGuard`, registrado como `APP_GUARD`: se aplica a los controllers de **todos** los módulos y niega por defecto, salvo los handlers o controllers marcados con `@Public()` (`shared/http/public.decorator.ts`). Un controller nuevo en cualquier módulo queda protegido sin hacer nada; abrirlo exige marcarlo a propósito. Lo que no es un handler de Nest (middleware de Express en `main.ts`: `/audio-files`, `/public`, `/docs`) queda fuera del guard. Detalle del contrato en `api-contract.md` §1.1.

Regla: las flechas solo van hacia abajo. `AgentsModule` no importa nada de `EpisodesModule` ni de `DebateModule` — solo expone un servicio que, dado un `DebateContext` (definido en `shared/contracts/`), devuelve un `ArgumentDraft` o `CrossExaminationDraft`. Esto es lo que permite testear cada módulo de dominio de forma aislada, sin levantar el pipeline entero.

`shared/` no depende de ningún módulo — es el único código que todos pueden importar sin generar ciclos. No tiene `@Injectable()` ni nada acoplado a NestJS (con la excepción de `shared/http/`, que sí son primitivas de NestJS — `ExceptionFilter`, decoradores, el documento OpenAPI — genéricas y sin lógica de negocio). Excepción conocida, anterior a API-8: `HttpErrorFilter` importa las clases de error tipadas de los módulos (`episodes`, `tts`, `render` y ahora `auth`) para mapearlas a status y `code`. `buildOpenApiDocument` recibe el nombre de la cookie de sesión como parámetro en vez de importarlo de `auth/`. `shared/crypto/` sí es puro: funciones sobre `node:crypto`, sin NestJS.

## 4. Patrón de orquestación: Episode como dueño único del estado

`Episode.status` (`EpisodeStatus`) es la única máquina de estados del sistema (ver `features.md` Feature 4 para la definición completa de estados y transiciones). Ningún otro módulo muta ese campo directamente — solo `EpisodeStateService` (dentro de `episodes/`) escribe en `Episode.status`, con un método por estado destino en vez de por arista `from→to` (permite reusar el mismo método en el flujo normal y en un resume, ver §7.1 y `decision-log.md` entrada 10).

El chequeo de presupuesto de la **AC 2.1** (`maxLlmCalls`/`maxSearchQueries`/`maxTtsSegments`) vive en `EpisodeBudgetService` (`episodes/episode-budget.service.ts`), consumido por `EpisodeOrchestratorService` antes de cada llamada externa:

```
EpisodeOrchestratorService.runResearchPhase(episodeId)
  1. si ya existe research completa para el topic (idempotencia) -> no llama a research() de nuevo
  2. si no: EpisodeBudgetService.withSearchRequest(() =>
              EpisodeBudgetService.withLlmCall(() =>
                ResearchService.research(topicId, manualSources?)))
     — research() consume TANTO 1 search request COMO 1 llamada LLM (la
       extracción de EvidenceFact), así que se envuelve con los dos
       wrappers anidados. Si cualquiera de los dos contadores ya está en
       el límite, EpisodeBudgetService lanza BudgetExceededError ANTES de
       llamar a research() — el orquestador lo mapea a
       REQUIRES_HUMAN_REVIEW (reason: USAGE_LIMIT_EXCEEDED)
```

`ResearchModule`, `AgentsModule` y `FactCheckModule` no conocen `EpisodeUsage` ni saben que existe un presupuesto — reciben la orden de ejecutar, la ejecutan, y devuelven el resultado (o lanzan su propia excepción tipada si fallan). La responsabilidad de decidir *si* se puede ejecutar es exclusiva de `EpisodeBudgetService`.

Mismo patrón para `EpisodeCheckpoint`: solo `EpisodeStateService.requireHumanReview()` lo crea, y solo `EpisodeStateService.resumeFromCheckpoint()` resuelve la acción `Resume` (retomando desde `checkpoint.fromState` — `EpisodeOrchestratorService.runPipeline()` es idempotente por re-chequeo de lo ya persistido en cada fase, así que el mismo método sirve para la corrida inicial, un resume, y una recuperación post-caída sin ramas de código por caller).

## 5. Resiliencia

### 5.1 Cockatiel (reactivo — retry / circuit breaker)

Cada módulo que habla con un servicio externo envuelve esa llamada donde vive la integración, con su propia instancia de policy (no se comparte una policy global entre módulos, fallan distinto):

- `ResearchModule` — retry/circuit-breaker alrededor del proveedor de búsqueda web (rate limits, timeouts) y, por separado, alrededor de la extracción con LLM.
- `AgentsModule` — alrededor de las llamadas a LLM vía AI SDK (rate limits, respuestas mal formadas que no pasan el `.parse()` de Zod).
- `FactCheckModule` — una sola policy para sus tres métodos (`extractClaims`/`check`/`editorialReview`, misma clase de integración).
- `TtsModule` — una policy propia por cada uno de los 2 proveedores externos (`google-tts.provider.ts`, `openrouter-audio.provider.ts`, todavía no implementados); el proveedor Local (`echogarden`), ya implementado, no la necesita — sin red en steady-state (`tasks.md` sección 5, `decision-log.md` entradas 19-22).

Las policies de retry usan `handleWhen` (no `handleAll`) para excluir explícitamente `DailyQuotaExceededError` — esa excepción la tira `LlmRateLimiterService` a propósito (cuota diaria agotada) y reintentarla en segundos no la resuelve (ver §5.2).

`EpisodesModule` no envuelve nada con Cockatiel directamente — consume los servicios de dominio, que ya devuelven resultados resueltos (éxito o excepción final tras agotar reintentos). Si un módulo de dominio agota sus reintentos y lanza, `EpisodeOrchestratorService.handlePipelineError()` lo captura y decide la transición de estado correspondiente (`FAILED` o `REQUIRES_HUMAN_REVIEW` según la causa, vía `EpisodeStateService`).

### 5.2 `LlmRateLimiterService` (proactivo — gate por `ModelProvider`)

A diferencia de Cockatiel (reactivo, por integración), `LlmRateLimiterService` (`ai/llm-rate-limiter.service.ts`) es un único gate **proactivo**, indexado por `ModelProvider` — el RPM/RPD de un free tier es un límite por API key, no por módulo llamante, así que Research/Agents/FactCheck comparten el mismo cupo aunque cada uno tenga su propia policy de Cockatiel aislada. `acquire(provider)` se llama **dentro** del bloque que cada servicio ya reintenta con Cockatiel, justo antes de `generateObject` — así los reintentos internos de Cockatiel también respetan el rate limit, no lo esquivan.

El estado se persiste en `LlmRequestLog` (una fila por request, ventana deslizante) para sobrevivir a reinicios del proceso. RPM espera (encola con un cap defensivo ~90s); RPD falla rápido con `DailyQuotaExceededError` (fail-fast — no tiene sentido esperar horas). Los límites concretos son configurables por env var (`GOOGLE_RPM_LIMIT`/`GOOGLE_RPD_LIMIT`, `OPENROUTER_RPM_LIMIT`/`OPENROUTER_RPD_LIMIT`) — `OPENAI`/`ANTHROPIC`/`XAI` no tienen límite proactivo configurado hoy (no hay uso real). Proceso de diseño completo en `decision-log.md` entrada 8.

**Nota sobre `OPENROUTER`**: dos modelos `:free` distintos comparten la misma cuenta/key de OpenRouter, y por lo tanto el mismo cupo real — por eso es un único valor de `ModelProvider` (no dos), con `ModelProviderFactory.resolve('OPENROUTER')` sorteando entre ambos modelos en cada llamada. Modelarlos como dos providers separados le hubiera hecho subestimar el uso real a `LlmRateLimiterService` (`decision-log.md` entrada 13). **Cambio planeado, no implementado** (spec 005, D12, decidido por el usuario; ADR 0003, propuesto): `liquid/lfm-2.5-2.6b:free` sale del pipeline y `OPENROUTER` queda solo con `nvidia/nemotron-3-super-120b-a12b:free`; además, `OPENROUTER` deja de participar de la verificación (extracción, hechos y editorial van a `GOOGLE`), así que su cupo (50 RPD por defecto) solo lo consumen la generación de un debatiente o el juez.

## 6. Modelo de dominio

El modelo de datos completo vive en `schema.prisma` (comentado inline). Resumen por módulo:

- **research**: `Topic`, `ResearchSession`, `Source`, `EvidenceFact`
- **agents**: `Agent`
- **debate**: `Debate`, `DebateRound` (tipada por `RoundType`: `OPENING`/`REBUTTAL`/`CROSS_EXAMINATION`), `Argument` (con `respondsToId` auto-referencial para cross-examination), `ArgumentHistory`, `Verdict`, `VerdictHistory` (spec 003, API-19: los veredictos reemplazados por la acción `regenerate-verdict`, archivados por `DebateService.replaceVerdict` en la misma transacción que borra el `Verdict` viejo y crea el nuevo; Feature 10, no se expone en la API; `judgeId`/`winnerId` sin FK a `Agent`). `Verdict` sigue siendo 1:1 con `Debate`, y "veredicto desactualizado" (`debate.verdict.stale`) no es una columna: se deriva de `ArgumentHistory.createdAt` posterior a `Verdict.createdAt`, así que toda mutación de un argumento OFFICIAL en `PENDING_REVIEW` tiene que archivar en `ArgumentHistory`. **Propuesto, no implementado** (ADR 0003, estado propuesto): `Argument.revision` (cantidad de reemplazos de contenido; `DebateService.replaceContent` la incrementa en el mismo `update`, sin romper el orden de #35); para un `DRAFT` es la cantidad de enmiendas hechas (D16)
- **fact-check**: `Claim`, `FactCheck`. **Propuesto, no implementado** (ADR 0003, estado propuesto; spec 005): `Claim.revision` (versión del argumento de la que se extrajo; "claims de la versión vigente" = `Claim.revision == Argument.revision`), `Claim.specificity` (enum `ClaimSpecificity` `CONCRETE`/`GENERAL`, solo en `FACTUAL`; decide si un `UNSUPPORTED` bloquea, D17) y `FactCheck.reusedFromId` (sin FK: resultado copiado de una versión anterior, D8)
- **ai**: `LlmRequestLog` (estado persistido del rate limiter, §5.2) — no es un módulo de dominio de producto, es infraestructura
- **notifications**: `Notification` (acoplada 1:1 a `Episode` — no hay otro emisor de notificaciones en el sistema, se descartó un modelo genérico/polimórfico por generalización prematura)
- **tts**: `AudioAsset` — `AudioProvider` ganó el valor `OPENROUTER`; las voces viven en `AgentVoice` (una fila por agente, idioma y proveedor; ADR 0002, migración `20260927120000_add_debate_language_agent_voice`) y `AudioAsset.voiceId` guarda la voz usada en cada segmento. Proveedor Local implementado y verificado; Google/OpenRouter pendientes (`decision-log.md` entradas 19-22)
- **render**: `Asset` (Feature 9, P1, módulo todavía no implementado). `RenderService` (Feature 7, P0, completa) es puro — no persiste nada propio, arma `RemotionManifest` a partir de datos de `Episode`/`Debate`/`Argument`/`AudioAsset`/`Verdict` que le pasa `EpisodesService`
- **episodes**: `Episode`, `EpisodeParticipant` (qué `Agent` + qué `ModelProvider` participa, y quién es el Judge), `EpisodeUsage`, `EpisodeCheckpoint` (historial, no 1:1 — ver Feature 10 de `features.md`). **Propuesto, no implementado** (ADR 0004, estado propuesto; spec 005, D10): `EpisodeLlmCall`, una fila por `withLlmCall` con operación, proveedor, modelo concreto, intentos, resultado y tokens; los tokens se suman a `EpisodeUsage.inputTokens`/`outputTokens` (hoy siempre en 0). No se expone en la API

`Topic` y `Debate` no tienen `status` propio — se derivan consultando el `Episode` asociado (ver sección 4).

## 7. Algoritmo de orquestación del debate

Decisiones de diseño (acordadas con el usuario) que resuelven la ambigüedad que tenía Feature 2:

- **Rondas configurables**: `Episode.openingRounds` / `rebuttalRounds` / `crossExaminationRounds` — no son un valor fijo del sistema.
- **Solo 2 agentes debaten por episodio** (de un pool de 4 personas: Analyst, Contrarian, Diplomat, Provocateur), con turnos secuenciales — no los 4 a la vez. Esto es clave para que el resultado sea una conversación entendible, no un mosaico de monólogos en paralelo.
- **Judge es un personaje fijo**, pero el modelo LLM que lo interpreta rota por episodio (`EpisodeParticipant.modelProvider`).
- **Asignación de cross-examination aleatoria** — quién examina qué argumento puntual, para que sea parejo entre agentes.
- **Paralelización solo en el fact-checking de claims** dentro de un mismo argumento — nunca en la generación de los argumentos en sí (son secuenciales por diseño, ver punto anterior). **Cambio propuesto (ADR 0003, estado propuesto; spec 005), no implementado:** sin paralelización en el pipeline; generación y verificación corren en serie (3 llamadas de verificación como máximo por versión, ver §7.3).

Implementado en `EpisodeOrchestratorService` (`episodes/episode-orchestrator.service.ts`), con la ayuda de `EpisodeParticipantsService` (§7.1), `EpisodeBudgetService` (§4) y `EpisodeStateService` (§4) como colaboradores.

### 7.1 Selección de participantes (al crear el episodio, transición `CREATED → RESEARCHING`)

```
1. Elegir 2 de las 4 personas debatientes al azar → EpisodeParticipant (isJudge: false) x2
2. Asignar un ModelProvider a cada una (al azar entre los configurados —
   EpisodeParticipantsService.getAvailableProviders() chequea presencia de
   env vars, sin tocar ModelProviderFactory)
3. Agent "Judge" → EpisodeParticipant (isJudge: true), con un ModelProvider
   distinto al de los dos debatientes si hay alguno libre (evita que el
   mismo modelo debata y juzgue en el mismo episodio); si no hay ninguno
   libre (caso real hoy con pocos providers configurados), sortea entre
   todos igual — fallback documentado, puede coincidir con un debatiente
```

Nota sobre `OPENROUTER` como `ModelProvider`: da acceso a 2 modelos `:free` distintos (`nvidia/nemotron-3-super-120b-a12b`, `liquid/lfm-2.5-2.6b`), pero es un único valor de enum, no dos — comparten la misma cuenta/key y por lo tanto el mismo cupo real de RPM/RPD de OpenRouter. `ModelProviderFactory.resolve('OPENROUTER')` sortea entre ambos modelos en cada llamada, así que "el ModelProvider" de un `EpisodeParticipant` puede, en la práctica, ejecutar dos modelos distintos turno a turno — el paso 2/3 de arriba sigue sorteando sobre `ModelProvider`, no sobre modelos individuales (`LlmRateLimiterService` trackea el cupo por `ModelProvider`, no por modelo — ver `decision-log.md` entrada 13). **Cambio planeado, no implementado** (spec 005, D12; ADR 0003, propuesto): con un solo modelo en `OPENROUTER` deja de haber sorteo, y un `EpisodeParticipant` en `OPENROUTER` solo genera (`argue`/`respond`/`amend`) o juzga: no extrae ni verifica claims. El modelo concreto de cada llamada queda en `EpisodeLlmCall` (ADR 0004, propuesto).

**Orden de turnos — sin columna nueva en `EpisodeParticipant`** (a diferencia de una versión anterior de este documento, que lo describía como un sorteo explícito hecho al armar los participantes): se deriva de forma perezosa, la primera vez que `runDebatePhase` lo necesita, mirando el `createdAt` del primer `Argument` (cualquier status) de la ronda OPENING/round 1 — si todavía no existe ninguno, se sortea recién ahí y ese orden queda "fijado" por ser el primero en persistirse. Evita tocar el schema de `EpisodeParticipant` y es naturalmente resistente a resume/recovery (`decision-log.md` entrada 10, decisión D-4).

### 7.2 Loop de rondas (estado `DEBATING`)

```
para cada round en 1..openingRounds:
  crear DebateRound(type=OPENING, round=N)
  para cada agente en el orden de turnos (7.1) que todavía no tenga
  un Argument OFFICIAL en esta ronda (idempotencia de resume/recovery):
    draft = agent.argue(context, 'OPENING')          // shared/contracts
    resultado = procesarBorrador(draft)               // ver 7.3
    context.officialArguments.push(resultado)          // el siguiente turno ya lo ve

para cada round en 1..rebuttalRounds:
  crear DebateRound(type=REBUTTAL, round=N)
  (mismo loop que OPENING — mismo orden de turnos, agent.argue(context, 'REBUTTAL'))

para cada round en 1..crossExaminationRounds:
  crear DebateRound(type=CROSS_EXAMINATION, round=N)
  para cada agente en el orden de turnos:
    target = DebateModule.pickCrossExaminationTarget(debateId, opponentAgentId)
              // Argument OFFICIAL del oponente, al azar, sin repetir si hay
              // más de uno disponible — puede lanzar NoCrossExaminationTargetError
              // (CheckpointReason.VALIDATION_INCONSISTENCY) si el oponente
              // no tiene ningún Argument OFFICIAL todavía
    draft = agent.respond(context, target)
    resultado = procesarBorrador(draft)
    context.officialArguments.push(resultado)
```

### 7.3 `procesarBorrador`: verificación por versión y loop de enmienda

> **Diseño propuesto, todavía no implementado.** Depende de ADR 0003 y ADR 0004 (los dos en estado **propuesto**) y de la spec 005. Mientras no se implementen, el código (`episode-orchestrator.service.ts`, `processDraft`) hace esto: 1 `extractClaims` con el proveedor del debatiente; 1 llamada por claim en un `Promise.all` (`check` con el proveedor del debatiente, `editorialReview` con `GOOGLE`, `decision-log.md` #14); `amend` con la primera falla; la vuelta se repite entera hasta `maxRevisionAttempts`, con el conteo de intentos solo en memoria.

Un `Argument` en `DRAFT` tiene una `revision` (cantidad de veces que se reemplazó su contenido). Los `Claim` llevan la `revision` de la que se extrajeron, así que "la versión vigente" es `Claim.revision == Argument.revision`. Toda la verificación usa `VERIFICATION_PROVIDER` (`GOOGLE`), sea cual sea el proveedor del debatiente (ADR 0003). Las llamadas corren en serie, cada una dentro de `withLlmCall` (ADR 0004).

```
runRound: si el agente ya tiene un DRAFT en la ronda → procesarBorrador(ese DRAFT)   // sin argue/respond (resume/recovery)
          si no → draft = argue/respond; procesarBorrador(createDraftArgument(draft))

procesarBorrador(arg):
  loop:
    r = arg.revision                        // = enmiendas ya hechas (sobrevive a resume/recovery)
    si el texto contiene un UUID → fallas = [FORMAT_VIOLATION]; ir a "fallas"   // 0 llamadas
    claims = FactCheck.getRevisionClaims(arg, r)
           ?: withLlmCall(EXTRACT_CLAIMS, FactCheck.extractClaims(arg, r, texto))   // 1 llamada; dedup + specificity
    pendientes = FactCheck.reuseVerifiedFacts(arg, r)      // copia resultados de versiones previas con statement igual
    si pendientes ≠ ∅ → withLlmCall(VERIFY_FACTS, FactCheck.verifyFacts(pendientes, evidenceBase))   // 1 llamada, lote
    no factuales = claims sin FACTUAL
    si ≠ ∅ → editorial = withLlmCall(EDITORIAL_REVIEW, FactCheck.reviewEditorial(no factuales, persona, texto))  // 1 llamada, lote
    fallas = FACTUAL de r con isBlockingFactCheck(veracity, specificity) + editoriales con passed=false
    emitir fact_check.completed { status, errorsDetected: |fallas| }
    si fallas = ∅ → DebateModule.promoteToOfficial(arg); devolver
  fallas:
    si r >= episode.maxRevisionAttempts →
      DebateModule.rejectArgument(arg); EpisodeState.requireHumanReview(MAX_REVISIONS_EXCEEDED, debateRoundId)
    amended = withLlmCall(AMEND, agent.amend(context, texto, { failures: fallas }, roundType))   // todas las fallas juntas
    arg = DebateModule.reviseDraft(arg, amended)          // revision + 1, archiva la versión anterior
```

Errores: un lote que después de los reintentos de Cockatiel no parsea, no cubre todos los claims o cita evidencia inexistente sale como `VerificationUnavailableError`. El orquestador lo mapea a `PROVIDER_QUOTA_EXCEEDED`: no cuenta como enmienda y no aprueba nada. Si se repite después de reanudar, la regla de repetición lo pasa a `FAILED` (ADR 0003, Consecuencias). Un `BudgetExceededError` entre dos llamadas deja persistido lo ya verificado de la versión. Al reanudar, la misma versión retoma solo lo que falta.

### 7.4 Veredicto (estado `JUDGING`)

Al terminar la última ronda de `CROSS_EXAMINATION`, `EpisodeOrchestratorService.runJudgingPhase` arma el `DebateContext` completo (todos los `officialArguments`), busca el `EpisodeParticipant` con `isJudge: true`, y llama `AgentsService.judge(context, judgeParticipant.modelProvider)` (usa `buildJudgeSystemPrompt` de `shared/personas/` y `VerdictOutputSchema` de `shared/contracts/` internamente). El resultado se persiste vía `DebateService.createVerdict(debateId, judgeId, verdict)`.

## 8. Referencias

- `features.md` — contrato de producto, máquina de estados de producto, criterios de aceptación por feature.
- `api-contract.md` — superficie HTTP completa (endpoints, SSE, formato de error, tabla de transiciones válidas).
- `coding-rules.md` — convenciones de código a seguir al implementar cada pieza.
- `docs/adr/0001-auth-sesion-nest-mismo-origen.md` — auth del curador (sesión emitida por Nest, Next como único origen), implementado en `modules/auth`.
- `decision-log.md` — bitácora del *proceso* detrás de cada decisión no obvia (qué se consideró, qué se descartó, qué evidencia real la resolvió).
- `tasks.md` — estado de implementación módulo por módulo.
- `shared/contracts/agents.contracts.ts` — contratos Zod y interfaz `DebateAgent`.
- `shared/personas/agents.personas.ts` — personas y reglas editoriales por agente.
- `schema.prisma` — modelo de datos completo.
