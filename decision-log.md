# Decision Log — AI Trend Debates

Bitácora cronológica de decisiones no obvias tomadas durante el desarrollo de este proyecto. A diferencia de `tasks.md` (que registra el *estado* de implementación — qué está hecho, con el motivo final resumido en una línea), acá se registra el *proceso*: qué problema apareció, qué opciones se consideraron (incluyendo las que se descartaron), qué evidencia resolvió la duda, y qué se terminó decidiendo. Pensada como insumo para un paper sobre el desarrollo de este proyecto — mantenerla actualizada en el momento de cada decisión, no reconstruida al final.

Convención: una entrada por decisión, con fecha, contexto breve, opciones consideradas, y resolución.

---

## 2026-09-07

### Qué providers de LLM son requeridos para arrancar el proceso

**Contexto**: `env.schema.ts` valida el entorno al boot (`ConfigModule.forRoot({ validate: validateEnv })`) — si una env var requerida falta, el proceso no levanta. Con 4 providers de LLM soportados (OPENAI/GOOGLE/ANTHROPIC/XAI), la pregunta era cuáles de las 4 API keys son obligatorias.

**Decisión**: solo `GOOGLE_API_KEY` es requerida — es la única con acceso gratuito disponible en ese momento. Las otras tres (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`) quedan `.optional()`; el proceso arranca sin ellas, y `ModelProviderFactory.resolve()` recién falla si algo intenta usar un provider sin key configurada. Marcado explícitamente para revisar "cuando se contrate una suscripción adecuada a los demás providers".

---

## 2026-09-08

### 1. `research()` no pertenece al contrato `DebateAgent`

**Contexto**: `DebateAgent` (interfaz runtime que implementan los agentes debatientes) definía `research(topic: string): Promise<ResearchOutput>` junto a `argue`/`respond`/`amend`, heredado del diseño original del contrato.

**Proceso**: se preguntó explícitamente cómo un agente que debate obtiene información nueva sobre el tema — ¿es parte de su rol como debatiente, o es el rol de otro tipo de agente (researcher)? Se releyó el algoritmo de orquestación (`architecture.md` §4/§7.1): `EpisodesModule.runResearch(episodeId)` llama a `ResearchModule.research(topic)` **una sola vez por episodio**, antes de que arranque el loop de rondas — la Evidence Base resultante viaja dentro de `DebateContext.evidenceBase` a cada `argue()`/`respond()`/`amend()`. Ningún `DebateAgent` busca evidencia nueva durante el debate, solo la lee. Fact-check tampoco busca evidencia nueva: contrasta lo que el agente ya escribió contra la Evidence Base ya obtenida.

**Decisión**: se eliminó `research()` del contrato `DebateAgent` (`shared/contracts/agents.contracts.ts`). Queda anotado como pendiente real: definir la firma equivalente (`ResearchService.research(topic)`) al construir `ResearchModule`.

### 2. `roundType` como parámetro explícito, no cerrado en el constructor de la instancia

**Contexto**: `AgentsService.createDebateAgent(persona, provider, roundType)` fabricaba una instancia nueva de `DebaterAgentImpl` por cada turno del loop de rondas, atada a un `roundType` fijo — porque el contrato `argue()`/`amend()` no lo recibía como parámetro pero `buildDebaterSystemPrompt` lo necesita.

**Proceso**: se preguntó directamente el motivo de fabricar una instancia nueva por turno — ¿era para limpiar contexto/memoria entre llamadas? Al revisar la clase, se confirmó que `DebaterAgentImpl` no tiene ningún estado mutable entre llamadas (todo lo que varía turno a turno ya viaja por parámetro en `DebateContext`) — la instancia nueva por turno no cumplía ninguna función real, era solo un workaround de firma para cerrar sobre `roundType`.

**Decisión**: se cambió el contrato para que `argue(context, roundType)` y `amend(context, original, feedback, roundType)` reciban `roundType` explícito. `AgentsService.createDebateAgent(persona, provider)` ahora crea **una sola instancia por episodio/agente**, reusada en todos sus turnos — el futuro `EpisodesModule` la crearía una vez al armar los participantes, no dentro del loop.

### 3. `pickCrossExaminationTarget`: de `Error` genérico a excepción tipada

**Contexto**: si el oponente no tiene ningún `Argument` en estado `OFFICIAL`, `DebateModule.pickCrossExaminationTarget` no puede elegir un target. La primera implementación tiraba un `Error` de JS sin tipar, bajo la premisa de que era un caso "imposible en operación normal" (CROSS_EXAMINATION llega después de que ambos agentes ya argumentaron en OPENING/REBUTTAL).

**Proceso**: al preguntarse si valía la pena tipar esta excepción, se pidió un ejemplo concreto de cuándo podría darse la condición. Se construyó el caso: `Episode.openingRounds`/`rebuttalRounds`/`crossExaminationRounds` son configurables independientemente (no fijos), y el flujo de curación humana ya contempla la acción `reject` sobre un argumento que agotó `max_revision_attempts` (en vez de arreglarlo) — combinando rondas cortas con esa resolución humana, un agente puede llegar a CROSS_EXAMINATION sin ningún argumento OFFICIAL. Es alcanzable en operación normal, no solo un bug de orquestación. Al buscar dónde encajaba esto en el modelo de datos, se encontró que `CheckpointReason.VALIDATION_INCONSISTENCY` ya existía en `schema.prisma`, definido en `features.md` exactamente para "inconsistencia en validación intermedia que no rompe el backend pero requiere árbitro humano" — no hizo falta inventar un reason nuevo.

**Decisión**: `pickCrossExaminationTarget` tira `NoCrossExaminationTargetError` (excepción tipada). Se documentó el flujo de resolución propuesto (`EpisodesModule` captura → `EpisodeCheckpoint` con `VALIDATION_INCONSISTENCY` → `REQUIRES_HUMAN_REVIEW` → resolución esperada vía la acción `regenerate` ya prevista en `api-contract.md`) en `frontend-notes.md`, ya que tiene implicancia directa en la UI que el curador va a usar.

### 4. Proveedor de búsqueda web para `ResearchModule`: Tavily

**Contexto**: `ResearchModule` necesitaba un proveedor de búsqueda web real, sin decidir todavía (`tasks.md` lo marcaba como bloqueante).

**Proceso**: se pidió explícitamente investigar alternativas **gratuitas** que cumplieran los requisitos (campos `title`/`url`/`snippet`/`publishedAt` de `Source`). Se compararon Tavily, Brave Search API, Exa y Serper — Brave había eliminado su tier gratuito real en 2026 (ahora pide tarjeta), Serper no tiene tier gratuito, Exa tiene buen tier gratuito pero está pensado para "semantic search". Se validó el volumen: con `max_search_queries_per_episode: 5` (`features.md`) y el free tier de Tavily (1000 créditos/mes, búsqueda básica = 1 crédito), el margen es de 100-200 episodios/mes en el peor caso — sobrado para un único usuario en local.

**Decisión**: Tavily. `TAVILY_API_KEY` se agregó como **requerida** en `env.schema.ts` (a diferencia de OPENAI/ANTHROPIC/XAI, que son opcionales) porque Research es P0 — no tiene sentido arrancar el proceso sin poder ejecutar una research real.

### 5. `DebateModule` no importa `AgentsModule` ni `FactCheckModule`

**Contexto**: el diagrama de dependencias de `architecture.md` §3 dibujaba `DebateModule` con `AgentsModule`/`FactCheckModule` "debajo" suyo, sugiriendo que `DebateModule` los importaba y coordinaba. Pero el pseudocódigo de orquestación (§7.2/§7.3) está escrito en la voz del orquestador (`agent.argue(context)`, `FactCheckModule.check(claim)`), no de `DebateModule`.

**Proceso**: se implementó `DebateModule` como módulo de persistencia/reglas de negocio puro (sin importar los otros dos), documentando la contradicción como punto a confirmar. Se preguntó directo y se confirmó: el diagrama estaba desactualizado, de una versión anterior de cuando la orquestación todavía se revisaba a mano y no estaba definida en detalle.

**Decisión**: se corrigió el diagrama en `architecture.md` §3 — los 6 módulos de dominio (`Research`, `Agents`, `Debate`, `FactCheck`, `Tts`, `Render`) cuelgan directo de `EpisodesModule`, sin jerarquía intermedia. Confirma que `DebateModule` tal como está implementado (sin esas dos importaciones) es correcto.

### 6. Modelo de Google para `ModelProviderFactory`: de `gemini-2.0-flash` a `gemini-3.5-flash-lite`

**Contexto**: al correr `scripts/smoke-test-argument.ts` (primera prueba real de punta a punta, sin mocks) contra las APIs reales, `research()` falló en el paso de extracción con Gemini.

**Proceso**: el error fue explícito — `gemini-2.0-flash` ya no está disponible (404, deprecado por Google). Se probó `gemini-2.5-flash`, mismo resultado (404, "no longer available to new users"). El error de la API señalaba `gemini-3.6-flash` como reemplazo — funcionó, pero con una cuota gratuita muy ajustada (429 "quota exceeded... limit: 5" en la primera corrida real). Antes de asumir que había que pagar, se investigó si "Gemini 3 Flash Live" (que en el dashboard de AI Studio mostraba RPM/RPD "ilimitado") era una alternativa — se descartó: es un producto distinto (Live API, conexión WebSocket para voz/video en tiempo real), no compatible con `generateContent`/`generateObject` de structured output. El usuario compartió la tabla completa de rate limits del dashboard de AI Studio, que permitió comparar todos los modelos con datos reales en vez de ir probando uno por uno: **todos** los "Flash" normales, sin importar la generación (3, 3.5, 3.6, 3.7, 3.8), estaban topeados igual — 5 RPM / 20 RPD —, mientras que las variantes "Flash Lite" (3.1 y 3.5) tenían 15 RPM / 500 RPD.

**Decisión**: `gemini-3.5-flash-lite` (la Lite más reciente disponible) — 25x más RPD que cualquier Flash normal, a cambio de algo menos de calidad/razonamiento, aceptable para este caso de uso (single-user, local, generación de contenido no crítica). Confirmado el tramo research→argumento funcionando de punta a punta con datos reales antes del cambio (con `gemini-3.6-flash`); pendiente re-confirmar con `gemini-3.5-flash-lite` si hiciera falta.

### 7. Este mismo documento

**Contexto**: el usuario planea escribir un paper sobre el desarrollo de este proyecto.

**Proceso**: se evaluó si valía la pena un documento nuevo separado de `tasks.md`. `tasks.md` registra bien el *qué* (estado final + motivo resumido), pero no el *proceso* de cada decisión — las opciones exploradas y descartadas, la evidencia concreta que resolvió cada duda. Ese proceso es justamente lo que le da valor a un paper, y no había ningún lugar donde quedara asentado más allá de la conversación misma.

**Decisión**: crear `decision-log.md`, con el formato de esta misma entrada — mantenerlo actualizado en el momento de cada decisión no obvia, no reconstruido al final de una sesión.
