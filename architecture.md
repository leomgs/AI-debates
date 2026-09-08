# Arquitectura — AI Trend Debates

Este documento formaliza las decisiones de arquitectura tomadas durante el diseño del backend. No repite el contrato de producto (eso vive en `01-product/features.md`) — se enfoca en **cómo** se implementa, no en **qué** hace cada feature.

## 1. Stack

| Tecnología | Rol |
|---|---|
| NestJS 11 | Framework de API + arquitectura modular + orquestación |
| Prisma 7 | Persistencia (SQLite en desarrollo local) |
| Vercel AI SDK | Abstracción multi-provider de LLMs, structured output |
| Zod 4 | Contratos de input/output de agentes (`shared/contracts/`) |
| Cockatiel | Retry / circuit breaker por integración externa |
| Tavily | Proveedor de búsqueda web para `ResearchModule` (Feature 1) — free tier 1000 créditos/mes sin tarjeta |
| google-tts-api | TTS inicial, gratuito, reemplazable por ElevenLabs vía `AudioProvider` |
| Jest | Tests unitarios e integración |

## 2. Mapa de módulos

```
src/
  modules/
    research/         ← Feature 1: Topic, ResearchSession, Source, EvidenceFact
    agents/            ← Agent (entidad) + implementaciones de DebateAgent por persona
    debate/            ← Debate, DebateRound, Argument, ArgumentHistory, Verdict
    fact-check/         ← Feature 3: Claim, FactCheck, filtro editorial
    tts/               ← Feature 6: AudioAsset
    render/            ← Feature 7/9: RemotionManifest, Asset
    episodes/           ← Feature 2/4/5: Episode, EpisodeUsage, EpisodeCheckpoint — el orquestador
  shared/
    prisma/            ← PrismaService, módulo global
    contracts/          ← agents.contracts.ts (Zod schemas + DebateAgent + DebateContext)
    personas/           ← agent-personas.ts (personas + system prompts)
```

Cada módulo de dominio (`research`, `agents`, `debate`, `fact-check`, `tts`, `render`) es responsable de un conjunto de entidades del `schema.prisma` y no conoce a `episodes`.

## 3. Dirección de dependencias

`EpisodesModule` es el único módulo que conoce el pipeline completo. Todo lo demás es un módulo de dominio que no sabe que `Episode` existe.

```
                                ┌───────────────────┐
                                │   EpisodesModule   │  (orquestador — único que conoce
                                │  (Episode,         │   el pipeline completo)
                                │   EpisodeUsage,    │
                                │   EpisodeCheckpoint)│
                                └─────────┬─────────┘
        ┌───────────────┬─────────────────┼─────────────────┬───────────────┬─────────────┐
        ▼                ▼                ▼                 ▼               ▼             ▼
  ResearchModule   AgentsModule     DebateModule      FactCheckModule    TtsModule    RenderModule
```

`EpisodesModule` llama a los seis módulos de dominio por separado y coordina el flujo entre ellos (ver §7) — ningún módulo de dominio importa a otro. En particular, `DebateModule` no importa `AgentsModule` ni `FactCheckModule`: es persistencia/reglas de negocio puras sobre `Debate`/`DebateRound`/`Argument`/`ArgumentHistory`/`Verdict`, sin llamar a ningún LLM ni proveedor externo (a diferencia de lo que sugería una versión anterior de este diagrama, desactualizada de cuando la orquestación todavía no estaba definida en detalle).

Regla: las flechas solo van hacia abajo. `AgentsModule` no importa nada de `EpisodesModule` ni de `DebateModule` — solo expone un servicio que, dado un `DebateContext` (definido en `shared/contracts/`), devuelve un `ArgumentDraft` o `CrossExaminationDraft`. Esto es lo que permite testear cada módulo de dominio de forma aislada, sin levantar el pipeline entero.

`shared/` no depende de ningún módulo — es el único código que todos pueden importar sin generar ciclos. No tiene `@Injectable()` ni nada acoplado a NestJS: son tipos, schemas Zod y funciones puras.

## 4. Patrón de orquestación: Episode como dueño único del estado

`Episode.status` (`EpisodeStatus`) es la única máquina de estados del sistema (ver `specs.md` Feature 4 para la definición completa de estados y transiciones). Ningún otro módulo muta ese campo directamente — solo `EpisodesModule` escribe en `Episode`.

El chequeo de presupuesto de la **AC 2.1** (`max_llm_calls`, `max_search_queries`, `max_tts_segments`) vive exclusivamente en `EpisodesModule`, antes de invocar cualquier módulo de dominio:

```
EpisodesModule.runResearch(episodeId)
  1. lee EpisodeUsage del episodio
  2. si searchRequests >= maxSearchQueries → transición a REQUIRES_HUMAN_REVIEW
     (reason: USAGE_LIMIT_EXCEEDED) y corta acá
  3. si hay margen → llama a ResearchModule.research(topic)
  4. incrementa EpisodeUsage.searchRequests con el resultado
```

`ResearchModule`, `AgentsModule` y `TtsModule` no conocen `EpisodeUsage` ni saben que existe un presupuesto — reciben la orden de ejecutar, la ejecutan, y devuelven el resultado. La responsabilidad de decidir *si* se puede ejecutar es exclusiva del orquestador.

Mismo patrón para `EpisodeCheckpoint`: solo `EpisodesModule` lo crea, y solo él resuelve la acción `Resume` (retomando desde `checkpoint.fromState` / `checkpoint.debateRoundId`).

## 5. Resiliencia (Cockatiel)

No hay una política de retry/circuit-breaker centralizada — cada módulo que habla con un servicio externo envuelve esa llamada donde vive la integración, porque cada una falla distinto:

- `ResearchModule` — retry/circuit-breaker alrededor del proveedor de búsqueda web (rate limits, timeouts).
- `AgentsModule` — alrededor de las llamadas a LLM vía AI SDK (rate limits, respuestas mal formadas que no pasan el `.parse()` de Zod).
- `TtsModule` — alrededor de google-tts-api / ElevenLabs (rate limits, cuotas).

`EpisodesModule` no envuelve nada con Cockatiel directamente — consume los servicios de dominio, que ya devuelven resultados resueltos (éxito o excepción final tras agotar reintentos). Si un módulo de dominio agota sus reintentos y lanza, el orquestador lo captura y decide la transición de estado correspondiente (`FAILED` o `REQUIRES_HUMAN_REVIEW` según la causa).

## 6. Modelo de dominio

El modelo de datos completo vive en `schema.prisma` (comentado inline). Resumen por módulo:

- **research**: `Topic`, `ResearchSession`, `Source`, `EvidenceFact`
- **agents**: `Agent`
- **debate**: `Debate`, `DebateRound` (tipada por `RoundType`: `OPENING`/`REBUTTAL`/`CROSS_EXAMINATION`), `Argument` (con `respondsToId` auto-referencial para cross-examination), `ArgumentHistory`, `Verdict`
- **fact-check**: `Claim`, `FactCheck`
- **tts**: `AudioAsset`
- **render**: `Asset`
- **episodes**: `Episode`, `EpisodeUsage`, `EpisodeCheckpoint` (historial, no 1:1 — ver Feature 10 de `features.md`)

`Topic` y `Debate` no tienen `status` propio — se derivan consultando el `Episode` asociado (ver sección 4).

## 7. Algoritmo de orquestación del debate

Decisiones de diseño (acordadas con el usuario) que resuelven la ambigüedad que tenía Feature 2:

- **Rondas configurables**: `Episode.openingRounds` / `rebuttalRounds` / `crossExaminationRounds` — no son un valor fijo del sistema.
- **Solo 2 agentes debaten por episodio** (de un pool de 4 personas: Analyst, Contrarian, Diplomat, Provocateur), con turnos secuenciales — no los 4 a la vez. Esto es clave para que el resultado sea una conversación entendible, no un mosaico de monólogos en paralelo.
- **Judge es un personaje fijo**, pero el modelo LLM que lo interpreta rota por episodio (`EpisodeParticipant.modelProvider`).
- **Asignación de cross-examination aleatoria** — quién examina qué argumento puntual, para que sea parejo entre agentes.
- **Paralelización solo en el fact-checking de claims** dentro de un mismo argumento — nunca en la generación de los argumentos en sí (son secuenciales por diseño, ver punto anterior).

### 7.1 Selección de participantes (al crear el episodio, transición `CREATED → RESEARCHING`)

```
1. Elegir 2 de las 4 personas debatientes al azar → EpisodeParticipant (isJudge: false) x2
2. Asignar un ModelProvider a cada una (al azar entre los configurados)
3. Agent "Judge" → EpisodeParticipant (isJudge: true), con un ModelProvider
   distinto al de los dos debatientes (evita que el mismo modelo debata
   y juzgue en el mismo episodio)
4. Definir el orden de turnos: se sortea una vez por episodio quién abre
   (participantA u participantB) — ese orden se mantiene consistente en
   todas las rondas OPENING/REBUTTAL de ese episodio.
```

### 7.2 Loop de rondas (estado `DEBATING`)

```
para cada round en 1..openingRounds:
  crear DebateRound(type=OPENING, round=N)
  para cada agente en el orden de turnos definido en 7.1:
    draft = agent.argue(context)                    // shared/contracts
    resultado = procesarBorrador(draft)              // ver 7.3
    context.officialArguments.push(resultado)         // el siguiente turno ya lo ve

para cada round en 1..rebuttalRounds:
  crear DebateRound(type=REBUTTAL, round=N)
  (mismo loop que OPENING — mismo orden de turnos)

para cada round en 1..crossExaminationRounds:
  crear DebateRound(type=CROSS_EXAMINATION, round=N)
  para cada agente en el orden de turnos:
    target = elegir al azar un Argument OFFICIAL del oponente
              (que todavía no haya sido target en este episodio,
              si hay más de uno disponible)
    draft = agent.respond(context, target)
    resultado = procesarBorrador(draft)
    context.officialArguments.push(resultado)
```

### 7.3 `procesarBorrador` — el loop de enmienda con paralelización acotada

```
draft → claim extraction (AgentsModule → FactCheckModule.extractClaims)
claims = [...]

// Paralelización: cada claim se despacha a su verificación en paralelo,
// PERO nunca dos llamadas concurrentes al mismo ModelProvider — se
// agrupan en una cola por proveedor para no pisar su rate limit.
resultados = para cada claim, en paralelo agrupado por ModelProvider:
  si claim.type == FACTUAL → FactCheckModule.check(claim)      // TRUE/FALSE/...
  si no                     → FactCheckModule.editorialReview(claim, persona)

si algún resultado es FALSE / MISLEADING / editorial.passed=false:
  intentos += 1
  si intentos > episode.maxRevisionAttempts:
    → Episode a REQUIRES_HUMAN_REVIEW (reason: MAX_REVISIONS_EXCEEDED,
       debateRoundId: ronda actual)
  si no:
    feedback = AmendmentFeedback (shared/contracts)
    draft = agent.amend(context, draft, feedback)
    reintentar procesarBorrador(draft)
si no:
  Argument.status → OFFICIAL
  devolver Argument
```

### 7.4 Veredicto (estado `JUDGING`)

Al terminar la última ronda de `CROSS_EXAMINATION`, se arma el `DebateContext` completo (todos los `officialArguments`) y se llama al `EpisodeParticipant` con `isJudge: true`, usando `buildJudgeSystemPrompt` (`shared/personas/`) y `VerdictOutputSchema` (`shared/contracts/`).

## 8. Referencias

- `features.md` — contrato de producto, máquina de estados de producto, criterios de aceptación por feature.
- `shared/contracts/agents.contracts.ts` — contratos Zod y interfaz `DebateAgent`.
- `shared/personas/agent-personas.ts` — personas y reglas editoriales por agente.
- `schema.prisma` — modelo de datos completo.
