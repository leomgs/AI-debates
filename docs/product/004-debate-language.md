# 004 — Idioma del debate por episodio

Estado: **especificada y revisada por `architect`** (2026-09-25). **Ajustada el 2026-09-27** (decisión del usuario, D20): la selección y carga de voces `EN` y `PT` sale del MVP y pasa a la mejora "Voces EN/PT". El ajuste pasó por `architect` el 2026-09-27 (aprobado con cambios, ya aplicados). Implementada en parte: pasos 3 (contratos) y 5a (`EpisodeContextService`). Las decisiones marcadas **fija** las tomó el usuario, salen de un ADR o están verificadas contra el código, y no se reabren acá. Las marcadas **decidido por defecto, revisable** son defaults razonables que se pueden cambiar sin rehacer la spec. El modelado de voces está en **ADR 0002** (`docs/adr/0002-voces-por-agente-e-idioma.md`). Lo que sigue sin resolverse está en "Preguntas abiertas".

## Contexto

Hoy todo episodio sale en español, pero no porque se haya elegido: es un efecto secundario de cómo está armado el pipeline.

- **Prompts**: todos están escritos en español rioplatense (con voseo) y ninguno le dice al modelo en qué idioma responder. Esto incluye a los debatientes y al juez (`apps/api/src/shared/personas/agents.personas.ts`, `apps/api/src/modules/agents/agents.service.ts`), al extractor de hechos del research (`research.service.ts`), al extractor de claims, al fact-checker y al filtro editorial (`fact-check.service.ts`). El idioma de salida lo termina decidiendo el modelo, influido por el idioma del prompt y del tópico.
- **Voces TTS**: `Agent.voiceId` guarda un `Json` con una voz por proveedor (`VoiceIdMap`, `decision-log.md` #20), no una por idioma. El seed (`apps/api/prisma/seed.ts:30-36`) solo carga voces en español (Piper `es_ES-*`/`es_MX-*`, Google `"es"`) y placeholders `"TBD"` para OpenRouter.
- **Research**: `TavilyProvider.search` manda el título del tópico tal cual, sin ningún parámetro de idioma ni de región.

El usuario quiere **elegir el idioma del debate al crear el episodio**: inglés, español o portugués. Además preguntó si alcanzaba con un parámetro en los agentes o si había que tocar el schema de la base.

### ¿Alcanza con un parámetro o hay que tocar el schema?

**Hay que tocar el schema.** El idioma tiene que guardarse en el episodio (`Episode.language`), porque el pipeline se corta y se retoma, y en cada reanudación reconstruye su contexto desde la base, no desde la request original:

| Punto de reentrada | Dónde | Qué reconstruye desde la base |
|---|---|---|
| Reanudar tras `REQUIRES_HUMAN_REVIEW` | `EpisodeActionsService.resume` → `runPipeline`/`runAudioPipeline` | Todo el contexto del debate o del audio |
| Recuperación tras un reinicio del proceso | `EpisodeRecoveryService.onApplicationBootstrap` (`RESEARCHING`, `DEBATING`, `JUDGING`, `GENERATING_AUDIO`) | Idem |
| `regenerate` en `PENDING_REVIEW` | `EpisodeActionsService.regenerate` (tiene su propia copia de `buildDebateContext`) | El contexto del debate |
| `regenerate-audio` en `READY_FOR_RENDER` | `EpisodeActionsService.regenerateAudio` → `TtsService.regenerateSegmentByIndex` | La voz de cada agente |
| `resume` de `INSUFFICIENT_EVIDENCE` | `runResearchPhase` → `ResearchService.research`, que vuelve a buscar en Tavily | El tópico |
| Manifest (preview y showcase) | `EpisodesService.getManifest`, que se arma en cada request | Las voces que informa `agents[].voiceId` |

Si el idioma no queda guardado, se pierde en el primer corte.

Además, el schema cambia en las **voces**. `Agent.voiceId` se reemplaza por una tabla `AgentVoice` con una fila por agente, idioma y proveedor (ADR 0002). También se agregan `AudioAsset.voiceId`, con la voz realmente usada, y un valor nuevo de `CheckpointReason` (`VOICE_NOT_CONFIGURED`).

## Personas

- **Curador**: el dueño del proyecto (spec 003). Elige el idioma al crear el episodio y lo ve en el panel.
- **Visitante del showcase**: ve el idioma de cada debate publicado y escucha el audio en ese idioma.

## Decisiones

Cada decisión incluye su razón. Una alternativa propuesta a mitad de la implementación tiene que refutar la razón, no solo ofrecer otra opción.

### Qué es el idioma del episodio

- **D1 — El idioma es un dato del episodio, persistido en la base (fija, verificada contra el código).** Razón: la tabla de reentradas de arriba. Todos los caminos que retoman el pipeline leen el episodio desde la base.
- **D2 — Es inmutable después de crear el episodio (decidido por defecto, revisable).** No existe ninguna acción ni endpoint que lo cambie. Razón: cambiar de idioma a mitad de camino dejaría un debate mezclado, con una Evidence Base redactada en otro idioma y audios ya sintetizados con voces de otro idioma. Si el curador eligió mal, rechaza el episodio y crea otro.
- **D3 — Enum cerrado `ES`, `EN`, `PT` (fija, usuario).** Agregar un idioma requiere una migración. Razón: agregar un idioma nunca es solo un valor, también exige la instrucción de idioma correspondiente y, antes de poder producir episodios en ese idioma, voces verificadas para los 5 agentes. El costo de la migración es marginal frente a eso. Además, el dashboard recibe un tipo cerrado en `openapi.json` (spec 003, D5). En el MVP, `EN` y `PT` están en el enum pero todavía sin voces (D20).
- **D4 — Si `createEpisode` no recibe idioma, se usa `ES`. Los episodios existentes se migran como `ES` (fija, usuario).** Razón: mantiene funcionando a los clientes que ya existen (curl, `/docs`, scripts de smoke test). El dashboard siempre lo manda explícito (AC 4.20).
- **D5 — Una variante fija por idioma.**
  - **`ES` = español neutro latinoamericano, con tuteo y sin regionalismos (fija, usuario). Las voces `ES` conservan por ahora la mezcla actual `es_ES`/`es_MX` (pregunta A, decisión del usuario): Piper solo tiene 2 voces `es_MX` y ninguna de otra región latinoamericana. Pasan a `es_MX` o latinoamericanas cuando exista un segundo motor de TTS (backlog de `tasks.md` §5).** La variante rige el texto, no el timbre.
  - **`EN` = inglés de Estados Unidos (`en_US`) y `PT` = portugués de Brasil (`pt_BR`) (decidido por defecto, revisable).** Propuestas por `product-analyst` como las variantes con más audiencia y, en principio, con más voces en el catálogo Piper. Rigen la instrucción de idioma desde el MVP. Las voces se confirman al elegirlas, en la mejora "Voces EN/PT" (D20).
  - Razón: la variante define qué voces se eligen y qué se le pide al modelo. Hoy el español ya está mezclado, con prompts en voseo rioplatense y voces `es_ES`/`es_MX`. Separar idioma de región (`es-AR`, `en-GB`…) multiplicaría las voces sin un caso de uso concreto.
  - Consecuencia: **el voseo desaparece de todos los prompts** (ver Restricciones técnicas, "Prompts").

### Contenido del debate

- **D6 — Todo texto que ve o escucha el público sale en el idioma del episodio.** Eso cubre argumentos (`OPENING`, `REBUTTAL`, `CROSS_EXAMINATION`), enmiendas, argumentos regenerados y veredicto. Razón: es el entregable, y es lo que el TTS lee en voz alta.
- **D7 — Los textos internos también salen en el idioma del episodio (fija, usuario).** Son los `EvidenceFact`, el `analysis` de cada `FactCheck` y el `violatedRule`/`reason` del filtro editorial, más el texto de respaldo fijo `"Violación de reglas editoriales."` (`episode-orchestrator.service.ts:371`). Razón: esos textos vuelven al debatiente como feedback de enmienda (`feedback.details`) y a los prompts como evidencia. Tenerlos en otro idioma aumenta el riesgo de que la salida cambie de idioma. El curador puede leer la auditoría (Feature 10) en otro idioma mientras esa UI no exista.
- **D8 — Mismos 4 debatientes y mismo juez en los 3 idiomas, con el mismo nombre y la misma personalidad. Solo cambia la voz (fija, usuario).** Razón: los nombres (`Analyst`, `Contrarian`, `Diplomat`, `Provocateur`, `Judge`) funcionan en los 3 idiomas, y no se toca el modelo de agentes ni la selección de participantes (`EpisodeParticipantsService` busca por `role`).
- **D9 — Research sin restricción de idioma; los hechos se redactan en el idioma del debate (fija, usuario).** La búsqueda en Tavily no cambia, y verificar si Tavily tiene parámetros de idioma deja de ser una precondición. Las fuentes (`Source.title`/`snippet`) quedan en su idioma original para mantener la trazabilidad (AC 1.2). Razón: restringir el idioma de búsqueda baja la cantidad de fuentes en tópicos de nicho y hace más probable `INSUFFICIENT_EVIDENCE`. Redactar los hechos en el idioma del debate evita que los debatientes y el fact-checker trabajen con evidencia mezclada.
- **D10 — No se valida el idioma de la salida en el MVP; se mide en los smoke tests (fija, usuario).** Razón: una validación extra consume llamadas LLM del presupuesto y puede llevar a `MAX_REVISIONS_EXCEEDED`. Primero hay que medir con qué frecuencia falla la instrucción de idioma (AC 4.8). Si falla con algún proveedor, la validación pasa a MVP. **Con D20, en el MVP solo se puede medir `ES`**: la medición en `EN` y `PT` (la que más informa sobre esta decisión) se hace en la mejora "Voces EN/PT", y recién ahí se decide si la validación hace falta para esos idiomas.
- **D11 — Los prompts siguen en español (neutro, con tuteo). El idioma se fija con una sola instrucción por idioma, redactada en el idioma de destino (fija, revisión de `architect`).** No hay un juego de prompts por idioma. Razón: un solo juego de prompts evita triplicar el mantenimiento de personas y reglas editoriales. Una instrucción corta en el idioma de destino alcanza para fijar la salida.
- **D12 — El tópico no se traduce (decidido por defecto, revisable).** `Episode.title` y `meta.topic` quedan como los escribió el curador. Razón: traducirlo sería una llamada LLM fuera del presupuesto, y el curador puede escribir el tópico directamente en el idioma elegido.

### Voces

- **D13 — Voces en la tabla `AgentVoice(agentId, language, provider, voiceId)`. Se elimina `Agent.voiceId` (fija, ADR 0002).** Reemplaza el punto 1 de `decision-log.md` #20. Razón: el ORM valida idioma y proveedor, la clave primaria garantiza una sola voz por combinación, y "falta la voz" se representa como "falta la fila", sin parsear `Json` en cada lectura.
- **D14 — Nunca hay respaldo silencioso ni placeholders (fija, ADR 0002).** Una voz que no se verificó contra el catálogo real no se carga: nunca `"TBD"`. OpenRouter no tiene filas. Razón, verificada por `architect`: con `voice: undefined`, Echogarden detecta el idioma del texto y elige la primera voz `vits` de ese idioma sin dar error (`echogarden/dist/api/Synthesis.js:42-73`). Con `"TBD"`, falla con "No matching voice found" y termina en `PROVIDER_QUOTA_EXCEEDED`, que describe mal el problema. Aplica a los datos de la base real (seed y migración). Los tests con `AudioProvider` mockeado pueden insertar filas de `AgentVoice` propias con `voiceId` ficticios, que tienen que ser visiblemente falsos (por ejemplo, `test-en-analyst`) y nunca nombres con forma de catálogo vits, para que no se confundan con voces verificadas. Esas filas viven en el setup del test y nunca en el seed. Precedente: `episodes.integration.spec.ts:54,58` usa `"voice-test"`.
- **D15 — Un idioma sin voces para el proveedor activo se rechaza con `VOICE_NOT_CONFIGURED` (fija, ADR 0002).**
  - En HTTP: `409 VOICE_NOT_CONFIGURED`, en `createEpisode` y en `regenerate-audio`. Orden en `createEpisode`: primero la validación de Zod (`400 VALIDATION_ERROR`, AC 4.1), después el chequeo de voces y recién después el primer insert (`research.createTopic`). El chequeo cubre a los **5 agentes candidatos**: los 4 roles de `DEBATER_PERSONAS` más `JUDGE`, resueltos por `role` como en `EpisodeParticipantsService`, porque todavía no se sabe cuáles 2 debatientes se van a sortear. Si falta la fila `Agent` de algún rol candidato, cuenta como agente sin voz y el `409` lo nombra por su rol.
  - En el pipeline: `REQUIRES_HUMAN_REVIEW` con el `CheckpointReason` nuevo `VOICE_NOT_CONFIGURED`, que se reanuda con body vacío después de cargar la voz.
  - Razón: el audio es la última fase. Descubrir la falta de voz después de gastar el presupuesto de LLM y la curaduría es el peor momento posible. En el pipeline todavía puede pasar si alguien borra voces después de crear el episodio.
- **D16 — El arranque falla si `TTS_PROVIDER` no es `LOCAL`, mientras no exista un segundo `AudioProvider` (fija, ADR 0002).** Razón, verificada por `architect`:
  - `tts.module.ts:20-26` enlaza siempre Echogarden, pero la voz se resuelve según `TTS_PROVIDER` (`tts.service.ts:123,129`).
  - Con `GOOGLE_TTS`, Echogarden recibe `"es"`/`"en"` y los busca por prefijo (`Synthesis.js:1054-1073`) sin dar error.
  - `AudioAsset.provider` queda mal etiquetado.
  - La validación de D15 tiene que consultar el mismo proveedor que realmente sintetiza.
- **D17 — `AudioAsset.voiceId` guarda la voz realmente usada (fija, ADR 0002).** El manifest toma la voz de ahí. Para los assets viejos (`null`), usa la resolución por idioma. Razón: así el manifest de un episodio ya sintetizado, o publicado, no cambia de voz si después se modifica el seed.
- **D20 — Las voces `EN` y `PT` salen del MVP y pasan a la mejora "Voces EN/PT" (fija, usuario, 2026-09-27).**
  - Qué sale del MVP: elegir las 5 voces `en_US`, cargar la asignación `PT` con repetición (juez con voz propia; los 4 debatientes comparten `pt_BR-edresson-low` y `pt_BR-faber-medium`) y el spike de velocidad y tono de vits para `PT`. El catálogo consultado el 2026-09-25 y la asignación `PT` acordada se conservan como referencia en la pregunta A.
  - Qué queda en el MVP: todo lo demás (enum, `Episode.language`, `AgentVoice`, migración que copia las voces actuales como `ES`, prompts sin voseo con instrucción de idioma para los 3 idiomas, `language` por parámetro en el pipeline, TTS con resolución por idioma y `VOICE_NOT_CONFIGURED`, y `language` en la API y el manifest). En el MVP, `AgentVoice` solo tiene filas `ES`.
  - **Comportamiento interino**: el enum sigue siendo `ES`/`EN`/`PT` en contratos, API y dashboard. Crear un episodio `EN` o `PT` responde `409 VOICE_NOT_CONFIGURED` sin crear filas, por el mismo mecanismo de D15 (AC 4.29), y el dashboard muestra el mensaje de AC 3.78 de la spec 003. No se agrega código específico para este estado: cuando el seed cargue las voces `EN`/`PT`, esos idiomas funcionan sin otro cambio.
  - Alternativas descartadas por el usuario: ocultar `EN`/`PT` en el selector del dashboard y recortar el enum a `ES`.
  - Razón: destrabar API-17 (bloqueante de la F2 del dashboard, spec 003) y la F2 sin esperar la elección de voces.
  - Costo aceptado: hasta cargar las voces no se pueden crear episodios `EN` ni `PT`, y el selector ofrece dos idiomas que siempre responden `409`.

### Exposición

- **D18 — El idioma se expone en toda superficie que describe un episodio.** Eso incluye `EpisodeDto` (respuesta de `createEpisode` y de las acciones que devuelven la fila), `getEpisodeDetail`, `listEpisodes` y `meta.language` del `RemotionManifest`, donde es obligatorio. Razón: el dashboard no puede inferirlo (spec 003, D5), y `packages/video` solo recibe el manifest (spec 002).
- **D19 — El panel sigue en español (spec 003, D8).** El idioma del debate no cambia el idioma de la UI ni el de los mensajes de `Notification`.

## No-objetivos

Fuera de alcance. Si algo de esto parece necesario, parar y preguntar:

- **Internacionalizar la UI del panel o del showcase.** El idioma de la interfaz del showcase es la pregunta 7 de la spec 003.
- **Traducir un episodio existente** a otro idioma, o generar el mismo debate en varios idiomas.
- **Detectar automáticamente el idioma del tópico.**
- **Cambiar el idioma de un episodio ya creado** (D2).
- **Prompts distintos por idioma** (D11), y **personajes o nombres por idioma** (D8).
- **Validar el idioma de la salida** (D10).
- **Restringir la búsqueda de Tavily por idioma o región** (D9).
- **Implementar los proveedores TTS pendientes** (Google, OpenRouter, Chatterbox; `tasks.md` §5). Mientras no existan, el arranque falla con cualquier `TTS_PROVIDER` que no sea `LOCAL` (D16).
- **Corregir que la descarga de un modelo de voz sin red salga como `PROVIDER_QUOTA_EXCEEDED`.** Es un problema previo (ADR 0002, Consecuencias).
- **Modificar la spec 003.** Los cambios que esta spec le pide al dashboard se listan en "Dependencias", y otro agente los integra en la 003.
- **En el MVP: ocultar o deshabilitar `EN`/`PT` mientras no tengan voces**, o manejar ese estado con código específico (D20). El rechazo lo da el `409` de D15.

## User stories

- **US 4.1** — Como curador, quiero elegir el idioma del debate al crear un episodio, para producir debates para audiencias que no hablan español. *(En el MVP la elección existe, pero solo `ES` produce episodios; `EN` y `PT` se completan con la mejora "Voces EN/PT", D20.)*
- **US 4.2** — Como curador, quiero que el debate completo salga en el idioma que elegí, sin mezclas, para no tener que corregirlo en la curaduría.
- **US 4.3** — Como curador, quiero que cada agente hable con una voz nativa del idioma del episodio, para que el audio sea escuchable. *(En el MVP se cumple para `ES`; `EN` y `PT`, en la mejora.)*
- **US 4.4** — Como curador, quiero que el idioma se mantenga si el episodio se frena y lo reanudo, si el backend se reinicia, o si regenero un argumento o un audio.
- **US 4.5** — Como curador, quiero ver el idioma de cada episodio en la lista y en el detalle.
- **US 4.6** — Como visitante del showcase, quiero ver en qué idioma está cada debate antes de abrirlo.
- **US 4.7** — Como curador, quiero que un episodio creado antes de esta feature siga funcionando (detalle, preview, regenerar audio) y figure como español.
- **US 4.8** — Como curador, quiero enterarme antes de crear un episodio de que un idioma no tiene voces configuradas, en vez de descubrirlo en la fase de audio.

## Criterios de aceptación

Numerados `AC 4.x`. Los números de la primera versión se conservan y los AC nuevos van a partir del 4.24. Los AC de backend se verifican con tests con el LLM y el TTS mockeados (se verifica qué recibe el proveedor, no la calidad de su salida). La salida real se verifica con smoke tests (`scripts/smoke-test-episode.ts`, `scripts/smoke-test-tts.ts` o equivalentes).

**Alcance tras D20 (2026-09-27)**: los tests con `AudioProvider` mockeado pueden cubrir `EN` y `PT` en el MVP cargando filas de `AgentVoice` de prueba en la base del test, con ids ficticios (D14); no necesitan voces reales ni tocan el seed. Lo que exige sintetizar audio real en `EN` o `PT` (smoke tests, subtítulos, escucha) no se puede correr en el MVP, porque `createEpisode` responde `409` para esos idiomas (AC 4.29). Esa parte está marcada **[mejora Voces EN/PT]** y se lista en "MVP vs. nice-to-have".

### Creación y persistencia

- **AC 4.1** — `createEpisode` acepta `language` opcional con los valores `ES`, `EN` y `PT`. Un valor fuera de esa lista devuelve `400 VALIDATION_ERROR` y no crea ninguna fila (`Topic`, `Debate`, `Episode` ni `EpisodeUsage`).
- **AC 4.2** — Si se omite `language`, el episodio se crea en `ES` (D4).
- **AC 4.3** — El idioma queda persistido desde la creación. Ninguna acción (`approve`, `edit`, `regenerate`, `reject`, `resume`, `regenerate-audio`, ni `publish`/`unpublish` de la spec 003) lo acepta ni lo modifica. Un body de `resume` con `language` se rechaza con `400 VALIDATION_ERROR`, porque sus schemas son `.strict()`.
- **AC 4.4** — Crear un episodio en un idioma donde a alguno de los 5 agentes candidatos (4 debatientes más el juez) le falta voz para el `TTS_PROVIDER` activo devuelve `409 VOICE_NOT_CONFIGURED`. El mensaje nombra el idioma, el proveedor y los agentes sin voz, y no se crea ninguna fila, porque la validación ocurre antes del primer insert (D15). Verificable con tests de integración que dejan sin voz a un agente. En el MVP, este mismo mecanismo es el que rechaza `EN` y `PT` (AC 4.29).
- **AC 4.5** — Tras la migración, todos los episodios existentes tienen `language = ES` y se ven así en el detalle y en el listado.

### Contenido del debate

- **AC 4.6** — Toda llamada generativa (`argue`, `respond`, `amend`, el `regenerate` de curaduría y `judge`) incluye la instrucción de idioma del episodio: como regla del system prompt y como última línea del prompt de usuario (D11). Verificable con tests que inspeccionan el prompt enviado para `ES`, `EN` y `PT` (MVP: no requiere voces).
- **AC 4.7** — Las llamadas evaluadoras (extracción de claims, fact-check, filtro editorial) y la extracción de hechos del research reciben el idioma. Su prompt indica en qué idioma está el texto evaluado y en qué idioma se escriben los campos libres (`statement`, `analysis`, `violatedRule`, `reason`, hechos) (D7, D9).
  - *MVP*: los tests verifican el prompt para `ES`, `EN` y `PT`.
  - *[mejora Voces EN/PT]*: en el smoke test real se revisan a mano los `feedback.details` de un episodio `EN` y uno `PT` para detectar rechazos atribuibles al idioma, y el resultado se anota en `decision-log.md`. No hay umbral automático.
- **AC 4.8** — Smoke test real: los argumentos oficiales y el veredicto están en el idioma del episodio, sin frases en otro idioma. Se registra en `decision-log.md` cuántos argumentos salieron en otro idioma, por proveedor LLM (D10).
  - *MVP*: un episodio `ES` (que además confirma el tuteo, AC 4.27).
  - *[mejora Voces EN/PT]*: un episodio `EN` y uno `PT`.
- **AC 4.9** — Ningún texto de persona inyectado en los prompts contiene frases literales en español que puedan copiarse a la salida. El ejemplo `'¿y si en realidad...?'` de `CONTRARIAN.voice` (`agents.personas.ts:67`) se reemplaza por una descripción neutra.

### Continuidad del idioma en los cortes

Los AC 4.10 a 4.13 son del MVP y se verifican con tests con el LLM y el `AudioProvider` mockeados y filas de `AgentVoice` de prueba para `EN`/`PT` en la base del test (no requieren voces reales).

- **AC 4.10** — Un episodio `EN` que pasa a `REQUIRES_HUMAN_REVIEW` en `DEBATING` y se reanuda produce los argumentos que faltan en inglés. Lo mismo al reanudar desde `JUDGING` (veredicto) y desde `GENERATING_AUDIO` (voces). Verificable con tests del orquestador.
- **AC 4.11** — Un episodio `PT` en `DEBATING`, `JUDGING` o `GENERATING_AUDIO` que retoma `EpisodeRecoveryService` conserva el idioma en el texto y en las voces. Verificable con tests de la recuperación.
- **AC 4.12** — `regenerate` en `PENDING_REVIEW` sobre un episodio `EN` produce el texto nuevo en inglés. El contexto sale del mismo servicio compartido que usa el orquestador (paso 5a del Plan).
- **AC 4.13** — `resume` de `INSUFFICIENT_EVIDENCE` en un episodio `EN` extrae los hechos nuevos en inglés.

### Audio y subtítulos

- **AC 4.14** — En la fase de audio y en `regenerate-audio`, cada segmento se sintetiza con la voz de `AgentVoice` que corresponde al agente, al idioma del episodio y a `LOCAL`. Verificable con tests que inspeccionan el `voiceId` que recibe el `AudioProvider` (MVP, con filas de prueba para `EN`/`PT`).
- **AC 4.15** — Si en la fase de audio falta la voz de un agente para el idioma del episodio, no se sintetiza ningún segmento con otra voz. El episodio pasa a `REQUIRES_HUMAN_REVIEW` con motivo `VOICE_NOT_CONFIGURED` (no `PROVIDER_QUOTA_EXCEEDED`). Después de cargar la voz, `resume` con body vacío retoma solo los segmentos pendientes. Un `resume` con body no vacío devuelve `400 VALIDATION_ERROR`. En `regenerate-audio`, el mismo caso devuelve `409 VOICE_NOT_CONFIGURED` y el segmento queda como estaba.
- **AC 4.16** — Cada `AudioAsset` nuevo guarda en `voiceId` la voz usada, y `manifest.agents[].voiceId` informa esa voz. Para assets sin `voiceId` (anteriores a la migración), el manifest informa la voz resuelta por idioma. Si se cambia una voz en el seed, el manifest de un episodio ya sintetizado no cambia.
- **AC 4.17** — **[mejora Voces EN/PT]** Con `LOCAL`, cada segmento de un episodio `EN` o `PT` trae `subtitles` no vacíos, y la secuencia de palabras corresponde al texto del segmento. Verificable en el smoke test real. (Los subtítulos `ES` ya funcionan hoy y no cambian.)

### API y contratos

- **AC 4.18** — `openapi.json` expone el enum `DebateLanguage` en la entrada de `createEpisode` y en las respuestas de `EpisodeDto`, `getEpisodeDetail`, `listEpisodes` y `RemotionManifest` (`meta.language`, obligatorio). El nuevo valor `VOICE_NOT_CONFIGURED` aparece en el enum de `CheckpointReason`. Regenerar dos veces no produce diff (criterio de la spec 001). Se acepta que nestjs-zod 5.5 duplique el enum como `DebateLanguage`/`DebateLanguage_Output`, pero hay que verificar con `openapi:generate` qué genera realmente.
- **AC 4.19** — `DebateLanguageSchema` vive en `packages/contracts`, y `packages/video` sigue sin importar nada de `apps/api` (`check-boundaries` pasa). El fixture `packages/video/fixtures/debate.sample.json` suma `"language": "ES"`, y `pnpm video:studio` sigue renderizando sin `.env` ni base de datos.

### Dashboard (dependencia de la spec 003, se implementa dentro de ella)

- **AC 4.20** — "Crear episodio" (`/studio/new`) tiene un selector de idioma con `ES` preseleccionado y siempre envía el idioma. Las opciones salen del enum de `openapi.json`, así que incluyen `EN` y `PT` también en el MVP (D20).
- **AC 4.21** — Si `createEpisode` devuelve `409 VOICE_NOT_CONFIGURED`, el formulario muestra el mensaje y conserva el tópico y el idioma elegidos. En el MVP es lo que ve el curador al elegir `EN` o `PT` (spec 003, AC 3.78).
- **AC 4.22** — La lista de `/studio` y la cabecera del detalle muestran un distintivo con el idioma de cada episodio.
- **AC 4.23** — El showcase (`/` y `/e/[id]`) muestra el idioma de cada episodio publicado: en la lista, desde la respuesta de `listShowcaseEpisodes` (API-7), y en el detalle, desde `manifest.meta.language`.

### Nuevos en la revisión

- **AC 4.24** — El backend no arranca si `TTS_PROVIDER` no es `LOCAL`, y el mensaje de error dice por qué (D16). Verificable con un test de configuración.
- **AC 4.25** — Después de migrar y correr el seed, cada uno de los 5 agentes tiene exactamente una fila de `AgentVoice` `ES` para `LOCAL`, con la misma voz que tenía antes de la migración, y una fila `ES` para `GOOGLE_TTS` con `"es"`. No hay filas `EN` ni `PT` para ningún proveedor, ninguna fila con `"TBD"` y ninguna para `OPENROUTER`. Una base migrada y una base nueva (`migrate reset` + seed) quedan con las mismas filas. El seed es idempotente: correrlo dos veces no cambia nada. Verificable con una consulta directa a la base. (Ajustado el 2026-09-27 por D20: las filas `EN`/`PT` pasan a AC 4.30.)
- **AC 4.26** — Los prompts no tienen voseo. Ningún prompt del backend (debatientes, juez, research, claims, fact-check, filtro editorial, `debaterSummary` del seed) usa formas como "sos", "querés", "presentá", "generá" o "devolvé". Verificable con una búsqueda en el código más revisión.
- **AC 4.27** — La instrucción de idioma para `ES` nombra la variante: español neutro latinoamericano, con tuteo y sin regionalismos (D5). En el smoke test `ES`, los argumentos no usan voseo.
- **AC 4.28** — Un `resume` sobre un checkpoint `VOICE_NOT_CONFIGURED` sin haber cargado la voz vuelve a frenar con el mismo motivo, y el episodio pasa a `FAILED` por repetición de causa, igual que con cualquier otro motivo (spec 003, AC 3.52).

### Nuevos en el ajuste del 2026-09-27 (D20)

- **AC 4.29** — **Comportamiento interino (MVP).** Con la base migrada y sembrada por el seed del MVP (solo voces `ES`), `createEpisode` con `language: "EN"` o `language: "PT"` responde `409 VOICE_NOT_CONFIGURED`. El mensaje nombra el idioma, el proveedor `LOCAL` y los 5 agentes candidatos. No se crea ninguna fila (`Topic`, `Debate`, `Episode` ni `EpisodeUsage`). Con `ES` o sin `language`, el mismo seed crea el episodio normalmente. Verificable con un test de integración sobre una base con solo filas `ES` y con una llamada real (curl o `/docs`) contra la base sembrada. Cuando la mejora "Voces EN/PT" carga las voces de un idioma, la parte de este AC que usa la base sembrada deja de aplicar para ese idioma (la reemplaza AC 4.30). El test de integración, que arma su propia base con solo filas `ES`, se conserva.
- **AC 4.30** — **[mejora Voces EN/PT]** Después de correr el seed con las voces de la mejora, cada uno de los 5 agentes tiene exactamente una fila de `AgentVoice` por idioma (`ES`, `EN`, `PT`) para `LOCAL`, cada `voiceId` es un nombre completo y exacto del catálogo vits verificado (Restricciones técnicas, "Echogarden"), y no hay filas con `"TBD"` ni para `OPENROUTER`. El seed sigue siendo idempotente. Con esas filas, `createEpisode` en `EN` y `PT` crea el episodio sin `409`, y un smoke test real en cada idioma llega a `READY_FOR_RENDER` (AC 4.7 parte smoke, 4.8 parte `EN`/`PT`, 4.17).

## Edge cases

- **El curador elige `EN` o `PT` antes de que exista la mejora "Voces EN/PT"**: `createEpisode` responde `409 VOICE_NOT_CONFIGURED`, no se crea nada, y el formulario conserva el tópico y el idioma (AC 4.29, 4.21; spec 003, AC 3.78). Es el comportamiento esperado del MVP, no un error.
- **Se cargan voces de un solo idioma** (por ejemplo, `EN` sí y `PT` no): `EN` pasa a crear episodios y `PT` sigue respondiendo `409`. Tampoco requiere código: la validación de D15 es por idioma.
- **Se cargan voces `EN`/`PT` para algunos agentes pero no para los 5**: `createEpisode` responde `409` nombrando a los agentes sin voz (AC 4.4). No se puede crear un episodio parcial aunque los 2 debatientes sorteados sí tuvieran voz.
- **Falta la fila `Agent` de un rol candidato**: cuenta como agente sin voz, y el `409` lo nombra por su rol (D15).
- **Tópico en un idioma y debate en otro** (por ejemplo, tópico en español y `EN`): se permite. El título queda como se escribió (D12). La búsqueda usa el título tal cual, así que las fuentes pueden estar en el idioma del tópico, pero los hechos se redactan en el idioma del debate (D9).
- **El modelo responde en otro idioma** a pesar de la instrucción: no se detecta en el MVP (D10). El curador lo ve en `PENDING_REVIEW` y puede usar `regenerate` o `edit`. Los smoke tests miden la frecuencia (AC 4.8).
- **El curador edita un argumento en otro idioma** (`edit`): se acepta sin validar, y el TTS lo lee con la voz del idioma del episodio. La UI puede recordar el idioma junto al editor.
- **Evidence Base entre episodios**: no se mezcla. Cada episodio crea su propio `Topic` (`episodes.service.ts:41`), y la idempotencia del research es por `topicId` (`episode-orchestrator.service.ts:537-541`). Dos episodios con el mismo tópico en idiomas distintos tienen Evidence Bases separadas, cada una redactada en su idioma.
- **Reglas editoriales en español evaluando texto en otro idioma**: se mantienen en español (D11). El evaluador sabe en qué idioma está el texto (AC 4.7). Los rechazos espurios se revisan a mano en el smoke test (en `EN`/`PT`, con la mejora).
- **Veredicto que cita la ronda**: los tipos de ronda viajan como `OPENING`/`REBUTTAL`/`CROSS_EXAMINATION`, así que el veredicto en portugués puede citarlos en inglés. Es aceptable, pero conviene revisarlo en el smoke test `PT` de la mejora.
- **Primera síntesis con una voz nueva**: Echogarden descarga el modelo de cada voz la primera vez (~15-100 MB). Sin red, falla como `PROVIDER_QUOTA_EXCEEDED` (problema previo, fuera de alcance). `setup.md` tiene que mencionar la pre-descarga.
- **Voz borrada después de crear el episodio**: el episodio pasó el chequeo de D15 al crearse, pero en la fase de audio falta la fila. Frena con `VOICE_NOT_CONFIGURED` (AC 4.15).
- **Cambio de voz en el seed con episodios ya sintetizados**: el manifest no cambia gracias a `AudioAsset.voiceId` (D17). En cambio, `regenerate-audio` usa la voz actual, así que un segmento regenerado puede sonar con otra voz que el resto del mismo agente en ese episodio (ver pregunta abierta B).
- **Catálogo `es_MX` limitado**: hoy el seed usa solo 2 voces `es_MX` (`es_MX-claude-high` y `es_MX-ald-medium`), y el catálogo español tiene 7 voces en total entre `es_ES` y `es_MX` (`decision-log.md` #22). Resuelto en la pregunta A: `ES` conserva la mezcla actual hasta que exista otro motor (D5).
- **Episodio en curso durante la migración**: un episodio en `DEBATING` que se retoma después de migrar queda en `ES`. Antes de migrar se revisan los episodios existentes (Plan, paso 4).
- **Longitud del texto según el idioma**: no cambia los límites (`ArgumentDraftSchema` admite hasta 2000 caracteres), pero sí la duración del audio.
- **Filtro de la lista por idioma**: no existe en el MVP.

## MVP vs. nice-to-have

**MVP** (la spec se cumple con esto):

- `Episode.language` persistido e inmutable (`ES`/`EN`/`PT`), con default `ES` y migración de los existentes (AC 4.1-4.5).
- Prompts en español neutro con tuteo, más la instrucción de idioma para los 3 idiomas en las llamadas generativas y evaluadoras, y textos internos en el idioma del episodio (AC 4.6, 4.7 parte tests, 4.8 parte `ES`, 4.9, 4.26, 4.27).
- Continuidad del idioma en resume, recovery, `regenerate` y `regenerate-audio`, con el contexto compartido (AC 4.10-4.13, con tests mockeados).
- `AgentVoice` solo con filas `ES` (`LOCAL` con las 5 voces actuales y `GOOGLE_TTS` con `"es"`), `VOICE_NOT_CONFIGURED`, falla de arranque con otro proveedor y `AudioAsset.voiceId` (AC 4.4, 4.14-4.16, 4.24, 4.25, 4.28).
- Comportamiento interino de `EN`/`PT`: `409 VOICE_NOT_CONFIGURED` sin crear filas (AC 4.29).
- Idioma en la API, en `openapi.json` y en el manifest (AC 4.18, 4.19). Con esto se cumple API-17 de la spec 003.
- Selector y distintivos en el dashboard, dentro de la spec 003 (AC 4.20-4.23).

**Mejora posterior: "Voces EN/PT"** (D20, decisión del usuario del 2026-09-27; no se implementa sin pedirlo):

- Incluye:
  - Elegir 5 voces `en_US` distintas (4 debatientes y juez) contra el catálogo vits, con el criterio de Restricciones técnicas ("Voces en inglés y portugués").
  - Cargar la asignación `PT` acordada en la pregunta A: el juez con voz propia (`pt_PT-tugao-medium` o una `pt_BR`, a definir en ese momento) y los 4 debatientes compartiendo `pt_BR-edresson-low` y `pt_BR-faber-medium`.
  - El spike de velocidad y tono de vits para diferenciar a los debatientes `PT` que comparten modelo (pregunta A, opción b; no verificado que Echogarden lo soporte).
  - Confirmar las variantes `en_US`/`pt_BR` de D5 con las voces elegidas; si el catálogo no alcanza, volver a D5.
  - Cargar las filas en el seed y documentarlas en `tasks.md` §5 (AC 4.30).
  - Smoke tests reales `EN` y `PT` hasta `READY_FOR_RENDER`: idioma de argumentos y veredicto (AC 4.8 parte `EN`/`PT`), revisión de `feedback.details` (AC 4.7 parte smoke), subtítulos (AC 4.17) y escucha del audio, con resultados en `decision-log.md`. Con esa medición se revisa D10 para `EN`/`PT`.
- No incluye código nuevo de pipeline, API ni dashboard: si el MVP está implementado, los idiomas se habilitan solo con el seed (D20). Si la medición de los smoke tests `EN`/`PT` justifica validar el idioma de salida (D10), esa validación es el nice-to-have de D10 promovido, se trata como trabajo aparte y la decide el usuario; no forma parte de esta mejora.
- Criterio para retomarla: el curador decide producir episodios en inglés o portugués, con el MVP de esta spec ya implementado (existe `AgentVoice` y AC 4.29 pasa). También se puede retomar cuando exista un segundo motor de TTS (`tasks.md` §5), que podría cambiar la elección de voces `PT` (y las de `ES`, pregunta A).
- Referencia conservada: el catálogo consultado el 2026-09-25 y las opciones de la pregunta A.

**Nice-to-have** (fuera del MVP; no se implementa sin pedirlo):

- Validar el idioma de la salida y mandar al loop de enmienda (D10; pasa a MVP si los smoke tests lo justifican).
- Traducir el tópico para el título público (D12).
- Filtro por idioma en `listEpisodes` y en el showcase.
- Atributo `lang` por episodio en el HTML del showcase (relacionado con la pregunta 7 de la spec 003).
- Advertencia en el formulario cuando el tópico parece estar en otro idioma que el elegido.
- Nombres de personajes traducidos por idioma (descartado para el MVP por D8).
- Voces para `GOOGLE_TTS`, `OPENROUTER` o Chatterbox, cuando esos proveedores existan.

## Restricciones técnicas

Diseño aprobado en la revisión de `architect` y en el ADR 0002.

- **Regla de flujo del idioma**: todo punto de entrada (el orquestador, `EpisodeActionsService` y `EpisodesService`) lee `Episode.language` de la base, y los módulos de dominio lo reciben por parámetro (`architecture.md` §3: ningún módulo de dominio importa a otro). Agregarlo solo a `DebateContext` no alcanza, porque varias llamadas no reciben ese contexto. Las firmas quedan así:
  - `FactCheckService.extractClaims`, `check` y `editorialReview` (`fact-check.service.ts:100,121,149`) reciben `language` como último parámetro.
  - `ResearchService.research(topicId, language, manualSources?)`.
  - `TtsService.synthesizeSegment(episodeId, argument, language)` y `regenerateSegmentByIndex(episodeId, sequenceIndex, language)`.
  - Los agentes lo reciben a través de `DebateContext.language`.
- **Contexto compartido**: se extrae `EpisodeContextService.build(episodeId)` en `modules/episodes/`, que reemplaza las dos copias de `buildDebateContext` (orquestador `:496`, acciones `:219`). Primero se extrae **sin cambio de comportamiento** y recién después se agrega el idioma (paso 5a). Razón: con dos copias, olvidar el idioma en una hace que `regenerate` salga en el idioma equivocado sin que falle ningún test del orquestador.
- **Prompts**:
  - Siguen en español, reescritos a español neutro con tuteo (D5). Se agrega `buildLanguageInstruction(language)` en `shared/personas`: una línea fija por idioma, redactada en el idioma de destino, para los 3 idiomas desde el MVP. Para `ES`, la línea nombra la variante (neutro latinoamericano, tuteo, sin regionalismos).
  - En las llamadas generativas, la instrucción va como regla del system prompt y como última línea del prompt de usuario.
  - En las evaluadoras, indica en qué idioma está el texto y en cuál salen los campos libres.
  - El voseo a reescribir no está solo en las líneas más visibles (`agents.personas.ts:168,184` y el `debaterSummary` del seed). También aparece en `ROUND_FRAMING` (`agents.personas.ts:155-159`: "presentá", "Reforzá o ajustá"), en `agents.service.ts` ("sos el primero en hablar", "Generá", "Te toca", "devolvé", "Recordá", "Emití"), en `fact-check.service.ts` ("Sos", "Segmentá", "Evaluá", "Citá") y en `research.service.ts` ("Sos", "usá", "Extraé"). AC 4.26 cubre todos.
  - El texto de respaldo `"Violación de reglas editoriales."` (`episode-orchestrator.service.ts:371`) tiene que salir en el idioma del episodio (D7).
  - La frase literal de `CONTRARIAN.voice` (`:67`) se reemplaza por una descripción neutra.
- **Contratos**:
  - `DebateLanguageSchema = z.enum(["ES","EN","PT"]).meta({ id: "DebateLanguage" })` vive en `packages/contracts`.
  - `RemotionManifestSchema.meta.language` es obligatorio.
  - `CreateEpisodeSchema = { topic, language: DebateLanguageSchema.default("ES") }.strict()`, y Prisma lleva `@default(ES)`.
  - `language` se agrega a `EpisodeSchema`, a `EpisodeListItemSchema` (y al `select` de `episodes.service.ts:60`), a `EpisodeDetailSchema`/`mapEpisodeDetail` y a `BuildManifestInput`.
  - `CheckpointReasonSchema` suma `VOICE_NOT_CONFIGURED`.
  - `features.md` Feature 7 está congelado y no lista `meta.language`. Se agrega como extensión documentada, con el mismo precedente que `audioUrl` (`decision-log.md` #27).
- **Checkpoint nuevo**: `VOICE_NOT_CONFIGURED` requiere estos cambios:
  - el enum `CheckpointReason` de Prisma;
  - `CheckpointReasonSchema`;
  - el switch de `applyResumeBody` (`episode-actions.service.ts:189-197`), que lo agrega a los casos con body vacío (`EmptyResumeSchema`);
  - un `catch` de `VoiceNotConfiguredError` en `handlePipelineError`, ubicado **antes** del de `TtsProviderUnavailableError` (`episode-orchestrator.service.ts:584`);
  - el mapeo HTTP a `409 VOICE_NOT_CONFIGURED` en el filtro de errores.
- **Echogarden**: no se le pasa idioma. La voz lo codifica, y `AudioProvider.synthesize` no cambia. Como los nombres se buscan por prefijo (`Synthesis.js:1054-1073`), los `voiceId` del seed tienen que ser nombres completos y exactos. Los subtítulos por palabra salen del `timeline` de la misma síntesis, así que con la voz correcta son coherentes con el texto.
- **Voces en inglés y portugués: fuera del MVP (D20), tarea de la mejora "Voces EN/PT".** Hay que consultar el catálogo con `Echogarden.requestVoiceList({ engine: 'vits', language: 'en' })` y `'pt'`, igual que en `decision-log.md` #22, y elegir 5 voces por idioma (4 debatientes y juez), dentro de la variante de D5 (`en_US`, `pt_BR`). Criterio: tier medium o high, sin repetir voz entre personas si el catálogo lo permite (en `PT` no lo permite: se aplica la asignación con repetición de la pregunta A). Para `GOOGLE_TTS`, el MVP conserva solo lo que la migración copia como `ES` (hoy `"es"`); las filas `"en"` y `"pt"` de `GOOGLE_TTS` no tienen efecto mientras rija D16 y se cargan con la mejora o con el proveedor Google, lo que ocurra primero. `OPENROUTER` no lleva filas.
- **Migración**: se escribe a mano y se aplica con `migrate deploy` (`decision-log.md` #21; ADR 0002, punto 7). Pasos:
  1. Crear `AgentVoice`.
  2. Copiar las voces actuales como `ES` con `json_each`, excluyendo `'TBD'` (quedan filas `LOCAL` y `GOOGLE_TTS`).
  3. Agregar `AudioAsset.voiceId` y completarlo en los assets existentes con la voz `LOCAL` que tenía su agente (pregunta B; AC 4.16). Tiene que ir antes del paso 4, porque lee `Agent.voiceId`.
  4. Reconstruir `Agent` sin `voiceId`, con el patrón de `20260909120000_agent_voiceid_json_add_openrouter` (FKs de `Argument`, `Verdict` y `EpisodeParticipant`; `VerdictHistory` no tiene FK a `Agent`).
  5. Agregar `Episode.language NOT NULL DEFAULT 'ES'`.
  - El seed hace upsert por `(agentId, language, provider)` y en el MVP solo carga `ES` (`LOCAL` con las 5 voces actuales y `GOOGLE_TTS` con `"es"`). Se corrige su comentario obsoleto (`seed.ts:49-51` dice que `Agent.name` no es `@unique`, pero `schema.prisma:182` sí lo es).
- **Tests y scripts**: cambian los tests que crean agentes con `voiceId` (por ejemplo, `episodes.integration.spec.ts:54,58`), y los scripts que llaman a `research` (`apps/api/scripts/smoke-test-argument.ts:31`) o arman un `DebateContext` a mano (`:44`). Los tests de integración que crean episodios `ES` tienen que cargar filas `AgentVoice` `ES`/`LOCAL` para los 5 agentes; si no, reciben el `409` de D15. Los tests de `EN`/`PT` del MVP cargan sus propias filas de `AgentVoice` de prueba con el `AudioProvider` mockeado; esas filas no van al seed y siguen la regla de ids ficticios de D14.

## Plan de implementación

1. **Voces**:
   - *MVP*: `ES` conserva las 5 voces actuales del seed (pregunta A), que la migración copia como `ES` (paso 4). No hace falta elegir ni descargar voces nuevas.
   - *[mejora Voces EN/PT]*: elegir las 5 `en_US` distintas y cargar la asignación `PT` con repetición (pregunta A), con el spike de velocidad y tono, contra el catálogo real. Documentarlas en `tasks.md` §5. Si el catálogo no permite `en_US` o `pt_BR` con voces suficientes, volver a D5. No bloquea ningún paso del MVP.
2. **Resolver las preguntas abiertas A y B.** Hecho (2026-09-25).
3. **Contratos**: `DebateLanguageSchema` en `packages/contracts`, `meta.language` en el manifest y el fixture de `packages/video` con `"language": "ES"`. Hecho (2026-09-25).
4. **Schema y migración** (ADR 0002). Antes de migrar, revisar los episodios existentes en `dev.db` (`SELECT id, title, status FROM Episode`) por si alguno quedó mal etiquetado como español. Aplicar con `migrate deploy`. Después, seed idempotente con solo voces `ES` y consulta directa para AC 4.5 y 4.25. Ya no depende del paso 1 de `EN`/`PT`.
5. **Pipeline**:
   - **5a.** Extraer `EpisodeContextService.build(episodeId)` y reemplazar las dos copias de `buildDebateContext` **sin cambio de comportamiento**, con los tests en verde, antes de tocar el idioma. Hecho (2026-09-25).
   - **5b.** Reescribir los prompts sin voseo, agregar `buildLanguageInstruction` para los 3 idiomas y neutralizar `CONTRARIAN.voice` (AC 4.6, 4.7, 4.9, 4.26, 4.27).
   - **5c.** Pasar `language` a `FactCheckService`, `ResearchService` y `DebateContext` según la regla de flujo (AC 4.10-4.13).
6. **TTS**: `AgentVoice`, `resolveVoiceId(agent, language)`, `assertVoicesConfigured`, `VoiceNotConfiguredError` con sus dos mapeos (HTTP y checkpoint), falla de arranque con `TTS_PROVIDER` distinto de `LOCAL` y `AudioAsset.voiceId` (AC 4.4, 4.14-4.16, 4.24, 4.28; AC 4.29 se cierra con el paso 7).
7. **API**: DTOs y respuestas, más `pnpm openapi:generate`. Verificar cómo queda nombrado el enum (AC 4.18, 4.19, y AC 4.29 con una llamada HTTP real). Con este paso se cumple API-17 de la spec 003.
8. **Smoke tests reales**:
   - *MVP*: un episodio `ES` hasta `READY_FOR_RENDER`: escuchar el audio, revisar los subtítulos y los `feedback.details`, confirmar el tuteo y anotar los resultados en `decision-log.md` (AC 4.8 parte `ES`, 4.27).
   - *[mejora Voces EN/PT]*: un episodio `EN` y uno `PT` hasta `READY_FOR_RENDER` (AC 4.7 parte smoke, 4.8 parte `EN`/`PT`, 4.17, 4.30).
9. **Docs**: `api-contract.md` §2 (request y respuesta de `POST /episodes`, cambiando el ejemplo por uno con `language`), el código de error `VOICE_NOT_CONFIGURED` (mencionando que en el MVP es la respuesta para `EN`/`PT`), `setup.md` (pre-descarga de voces y `TTS_PROVIDER` limitado a `LOCAL`) y entradas en `decision-log.md`, incluida la nota de que el punto 1 de #20 queda reemplazado por el ADR 0002. `features.md` no se toca.
10. **Dashboard**: AC 4.20-4.23, dentro de las fases F2 y F4 de la spec 003.

## Criterio de aceptación

La spec (MVP) se considera implementada cuando todo lo siguiente da verde:

- `pnpm build` compila todo el workspace, y los tests pasan, ajustados solo donde el contrato cambió a propósito.
- `pnpm openapi:generate && git diff --exit-code openapi.json` da 0 después de commitear el `openapi.json` regenerado.
- `check-boundaries` pasa, y `pnpm video:studio` renderiza el fixture sin `.env` ni base de datos.
- Tests automatizados de AC 4.1-4.6, 4.7 (parte tests), 4.9-4.16, 4.18, 4.24, 4.28 y 4.29 en verde.
- Consulta directa a la base que confirma AC 4.5 y 4.25 (solo `ES`, igual en base migrada y base nueva), y búsqueda en el código que confirma AC 4.26.
- Smoke test real en `ES` hasta `READY_FOR_RENDER` (AC 4.8 parte `ES`, 4.27), con resultados en `decision-log.md`. La llamada HTTP real que confirma el `409` de `EN`/`PT` (AC 4.29) se hace en el paso 7.
- Un episodio creado antes de la migración sigue abriendo su detalle y su manifest, y figura como `ES`.
- AC 4.20-4.23 verificados cuando se implementen las pantallas de la spec 003.

La mejora "Voces EN/PT" se considera implementada cuando pasan AC 4.30, AC 4.17, la parte smoke de AC 4.7 y la parte `EN`/`PT` de AC 4.8, con resultados en `decision-log.md`.

## Dependencias con otras specs, features y docs

- **ADR 0002** (`docs/adr/0002-voces-por-agente-e-idioma.md`): tabla `AgentVoice`, `VOICE_NOT_CONFIGURED`, arranque solo con `LOCAL`, `AudioAsset.voiceId` y la migración.
- **Spec 001**: el idioma y el nuevo `CheckpointReason` entran en los DTOs y en `openapi.json`.
- **Spec 002**: `DebateLanguageSchema` y `meta.language` viven en `packages/contracts`, y el fixture de `packages/video` se actualiza.
- **Spec 003** (`003-dashboard-ui.md`). **Otro agente hace estos cambios en paralelo. Esta spec no la toca, solo los lista**:
  - §7 (resolución de `REQUIRES_HUMAN_REVIEW`): nueva fila para `VOICE_NOT_CONFIGURED`. Explica que falta la voz de un agente para el idioma del episodio y ofrece "Reanudar" (body `{}`) después de cargar la voz, y "Rechazar".
  - API-10: suma el código de error `VOICE_NOT_CONFIGURED`.
  - AC 3.22 ("un único campo `topic`") y el no-objetivo "`createEpisode` solo acepta `topic`": se modifican para incluir el selector de idioma (AC 4.20). Además, `/studio/new` tiene que manejar el `409 VOICE_NOT_CONFIGURED` (AC 4.21). Con D20, el selector ofrece las 3 opciones y `EN`/`PT` terminan en el mensaje de AC 3.78 hasta la mejora "Voces EN/PT"; la 003 ya lo cubre sin cambios.
  - API-17 (bloqueante de la F2): lo entrega el MVP de esta spec (pasos 3, 6 y 7) y no depende de la mejora "Voces EN/PT".
  - API-1 (detalle) y `listShowcaseEpisodes` (API-7): suman `language` (AC 4.22, 4.23).
  - Pregunta 7 (idioma del showcase): esta spec da el dato para "sigue el idioma de cada episodio", pero no la resuelve.
  - Nota: `apps/dashboard/src/app/layout.tsx:23` tiene `lang="en"`, aunque el panel es en español (D8 de la 003).
  - Su nice-to-have "selector de idioma" se refiere al idioma de la UI, no al del debate.
- **`features.md`** (congelado): Feature 1 (tópico como string) y Feature 7 (contrato del manifest) quedan incompletas respecto de esta spec. No se editan.
- **`api-contract.md`**: §1 (códigos de error) y §2 (`POST /episodes`) se actualizan en el paso 9.
- **`decision-log.md` #20** (su punto 1 queda reemplazado por el ADR 0002), **#21** (migración con `migrate deploy`) y **#22** (catálogo Piper en español).
- **`tasks.md` §5**: cuando se implementen Google, OpenRouter y Chatterbox, tienen que levantar la restricción de D16 y cargar voces verificadas en `AgentVoice`. No está verificado que Chatterbox soporte inglés y portugués.

## Preguntas abiertas

Las preguntas 1 a 6 de la primera versión quedaron resueltas (ver abajo). Las dos que surgieron al integrar las decisiones (A y B) quedaron resueltas el 2026-09-25, después de consultar el catálogo real. No quedan preguntas abiertas propias de esta spec.

**A. No alcanzan las voces para `ES` y `PT`: resuelta (2026-09-25, decisión del usuario).** `ES`: se mantiene la mezcla actual `es_ES`/`es_MX` del seed hasta que haya otro motor (opción c). `PT`: se repiten voces, el juez lleva voz propia y los debatientes comparten las dos `pt_BR`, con un spike para diferenciar por velocidad y tono (opción a más el spike de b); todas las voces `PT` son masculinas, limitación conocida. Contexto: Cada episodio usa 3 voces (2 debatientes elegidos entre 4 personas, más el juez; `episode-participants.service.ts:21`). Como la asignación de voz es fija por agente, garantizar 3 voces distintas en **cualquier** episodio exige que los 5 agentes tengan voces distintas.

**Actualización 2026-09-27 (D20, decisión del usuario)**: la parte `ES` de esta resolución sigue en el MVP. La asignación `PT` y la elección de voces `en_US` pasan a la mejora "Voces EN/PT"; la resolución `PT` de arriba, el catálogo y las opciones de abajo se conservan como referencia para cuando se retome.

**Catálogo real** (2026-09-25, `Echogarden.requestVoiceList({ engine: "vits", language })` corrido contra el paquete instalado en `apps/api`):

| Idioma | Voces vits | Detalle |
|---|---|---|
| `es` | 7 | `es_MX`: solo 2 (`es_MX-ald-medium` masculina, `es_MX-claude-high` femenina). `es_ES`: 5 (`carlfm-x_low`, `sharvard-medium` con 2 speakers, `davefx-medium`, `mls_9972-low`, `mls_10246-low`, todas masculinas). **No hay voces de otras regiones latinoamericanas**, así que la opción (b) original no existe. |
| `en` | 35 | 23 `en_US` y 12 `en_GB`, de los dos géneros, varias `-high`. Alcanza de sobra para 5 voces `en_US` distintas (D5). |
| `pt` | 3 | `pt_BR-edresson-low`, `pt_BR-faber-medium` y `pt_PT-tugao-medium`, las 3 masculinas. **No alcanza para 5 voces distintas ni mezclando `pt_PT`.** |

El código actual no elige speaker en los modelos multi-speaker (no hay ninguna referencia a `speaker` en `modules/tts`), así que `es_ES-sharvard-medium` cuenta como una sola voz.

Opciones para `ES`:
- (a) Solo `es_MX`, repitiendo voces: con 2, en algunos episodios dos agentes suenan igual.
- (b) `es_MX` para el juez y para un debatiente, y `es_ES` para el resto. Hay 5 voces distintas, a costa de mezclar acentos, aunque el texto sea neutro latinoamericano.
- (c) Aceptar `ES` con la mezcla de hoy hasta que exista un segundo motor de TTS (Google TTS o Chatterbox, backlog de `tasks.md` §5) con más voces latinoamericanas.

Opciones para `PT`:
- (a) Repetir voces: 3 voces para 5 agentes. El juez lleva una voz propia (`pt_PT-tugao-medium` o una `pt_BR`) y los debatientes comparten las dos `pt_BR`.
- (b) Diferenciar agentes que comparten modelo variando velocidad y tono, si Echogarden lo soporta para vits. **No está verificado.**
- (c) Dejar `PT` fuera del MVP y habilitarlo cuando haya otro motor.

Recomendación: en `ES`, **(b)**, porque la distinción entre voces pesa más en un debate que la pureza del acento, y D5 rige el texto, no el timbre. En `PT`, **(a)** para el MVP, con un spike de (b). Todas las voces de `PT` son masculinas: queda registrado como limitación conocida.

**B. Voz de los episodios `ES` existentes: resuelta (2026-09-25, decisión del usuario, opción b).** La migración completa `AudioAsset.voiceId` de los assets existentes con la voz `LOCAL` que tenía su agente en ese momento. Así el manifest de los episodios viejos informa la voz realmente usada (AC 4.16). Se acepta que un `regenerate-audio` sobre un episodio viejo mezcle la voz vieja con la nueva. Si algún episodio viejo llega a publicarse, se resintetiza completo.

### Resueltas (2026-09-25, decisiones del usuario)

1. **Personajes**: los mismos 4 más el juez, y cambia solo la voz → D8.
2. **Research**: sin restricción de idioma, con los hechos redactados en el idioma del debate. Tavily no cambia → D9.
3. **Default y lista**: `ES` por defecto y enum cerrado → D3, D4.
4. **Variante**: `ES` neutro latinoamericano con tuteo (usuario); voces `ES` actuales hasta otro motor (pregunta A); `EN` = `en_US` y `PT` = `pt_BR` (revisable) → D5.
5. **Textos internos**: en el idioma del episodio → D7.
6. **Validar la salida**: no en el MVP; se mide → D10.

### Resueltas (2026-09-27, decisión del usuario)

7. **Voces `EN`/`PT` fuera del MVP**, con el enum completo y `409 VOICE_NOT_CONFIGURED` como comportamiento interino; se descartaron ocultar `EN`/`PT` en el selector y recortar el enum → D20.

## Riesgos

- **Frecuencia real de salida en otro idioma**: se desconoce hasta correr los smoke tests (D10, AC 4.8), sobre todo con modelos `:free` de OpenRouter. Con D20, en `EN` y `PT` se sigue desconociendo hasta la mejora "Voces EN/PT".
- **Rechazos espurios del filtro editorial** por evaluar texto en otro idioma contra reglas en español. Consumen presupuesto de LLM, y se revisan a mano (AC 4.7).
- **Enum duplicado en OpenAPI** (`DebateLanguage`/`DebateLanguage_Output`, nestjs-zod 5.5): se acepta, pero puede generar dos tipos en el cliente del dashboard. Hay que verificarlo en el paso 7.
- **Descarga de voces sin red**: sigue saliendo como `PROVIDER_QUOTA_EXCEEDED` (fuera de alcance, ADR 0002).
- **Catálogo Piper** (riesgo de la mejora "Voces EN/PT"): `en_US` y `pt_BR` pueden no tener 5 voces de calidad aceptable. Si pasa, se vuelve a D5 (Plan, paso 1).
- **Idiomas ofrecidos que siempre fallan** (D20): mientras no exista la mejora, el selector del dashboard ofrece `EN` y `PT` y ambos terminan en `409`. Es un costo aceptado por el usuario; el riesgo es que el estado interino se vuelva permanente sin que nadie lo decida.
- **La migración reconstruye `Agent`**: toca las FKs de `Argument`, `Verdict` y `EpisodeParticipant`. Hay que seguir el patrón de `PRAGMA` de #21, verificado en la migración `20260909120000`, y completar `AudioAsset.voiceId` antes de la reconstrucción (Restricciones técnicas, "Migración", paso 3).

## Bitácora

- **2026-09-25** — Primera versión, escrita por `product-analyst` a partir del pedido del usuario ("elegir el idioma del debate al crear un episodio"; "¿alcanza con un parámetro o hay que tocar el schema?") y del análisis previo de la sesión principal, verificado contra el código de `apps/api`, `packages/contracts` y `packages/video`.
- **2026-09-25** — **Revisión de `architect` integrada**, y de esa revisión salió el **ADR 0002** (voces por agente e idioma en `AgentVoice`, que reemplaza el punto 1 de `decision-log.md` #20).
  - **Decisiones del usuario**: las preguntas 1, 2, 3, 5 y 6 pasan a D8, D9, D3/D4, D7 y D10. La pregunta 4 se resuelve como `ES` neutro latinoamericano, con tuteo y voces `es_MX`, lo que obliga a reescribir el voseo de todos los prompts (D5).
  - **Del ADR y la revisión**: `VOICE_NOT_CONFIGURED` como `CheckpointReason` y como `409` (D15), arranque solo con `TTS_PROVIDER=LOCAL` (D16), `AudioAsset.voiceId` (D17) y nunca placeholders `"TBD"` (D14). También: la regla de flujo del idioma por parámetro a los módulos de dominio, `EpisodeContextService` (paso 5a), `buildLanguageInstruction` sin prompts por idioma (D11), `DebateLanguageSchema` en contratos y la migración manual.
  - **AC**: se reescribieron 4.4, 4.7, 4.13, 4.15 y 4.16, y se agregaron 4.24-4.28.
  - **Preguntas nuevas**: A (voces `es_MX` insuficientes) y B (voz de los episodios `ES` existentes).
  - **Hallazgo propio en esta pasada**: el voseo aparece en más prompts que los señalados (`ROUND_FRAMING`, `agents.service.ts`, `fact-check.service.ts`, `research.service.ts`).
  - Registrada en `docs/product/README.md` (2026-09-25).
- **2026-09-25, catálogo de voces y preguntas A/B**: se consultó el catálogo real de Echogarden vits (`es` 7 voces, de las cuales 2 `es_MX` y ninguna de otra región latinoamericana; `en` 35; `pt` 3, todas masculinas). El usuario resolvió la A: en `ES` se mantienen las voces actuales del seed hasta que exista otro motor, y en `PT` se repiten voces con un spike de velocidad y tono. También resolvió la B: la migración completa `AudioAsset.voiceId` de los assets existentes. D5 queda acotada al texto; el timbre de `ES` se revisa con el segundo motor de TTS.
- **2026-09-27, voces `EN`/`PT` fuera del MVP** (decisión del usuario, ajuste de `product-analyst`):
  - **Decisión**: D20. La elección de voces `en_US`, la asignación `PT` con repetición y el spike de velocidad y tono pasan a la mejora "Voces EN/PT". Razón: destrabar API-17 y la F2 del dashboard sin esperar la elección de voces. Costo aceptado: no se pueden crear episodios `EN`/`PT` hasta cargar las voces.
  - **Comportamiento interino**: enum completo; `EN`/`PT` responden `409 VOICE_NOT_CONFIGURED` sin crear filas, sin código extra (AC 4.29).
  - **AC**: 4.25 pasa a solo `ES`; 4.7 y 4.8 se parten entre MVP (tests de prompt; smoke `ES`) y mejora (smoke `EN`/`PT`); 4.17 pasa entero a la mejora; 4.4, 4.6, 4.10, 4.11, 4.14, 4.20 y 4.21 aclaran su alcance sin cambiar lo que exigen; se agregan 4.29 (interino, MVP) y 4.30 (seed `EN`/`PT`, mejora).
  - **Otros**: D3, D5 y D10 anotan la consecuencia de D20; Plan, Restricciones técnicas, edge cases, MVP vs. nice-to-have (nueva sección "Mejora posterior: Voces EN/PT"), criterio de aceptación, dependencias con la 003, pregunta A (actualización), riesgos. El edge case del catálogo `es_MX` se alineó con la pregunta A ya resuelta.
- **2026-09-27, revisión de `architect` del ajuste: aprobado con cambios, aplicados** (M1-M5, m1-m4, m6):
  - **M1**: la migración completa `AudioAsset.voiceId` antes de reconstruir `Agent` (lee `Agent.voiceId`); se anota que `VerdictHistory` no tiene FK a `Agent`.
  - **M2**: AC 4.25 exige también la fila `ES`/`GOOGLE_TTS` con `"es"`, ninguna fila `EN`/`PT` para ningún proveedor, y que una base migrada y una base nueva queden iguales; la línea del seed y el MVP lo reflejan.
  - **M3**: la mejora no incluye la validación de idioma de D10; si la medición la justifica, es trabajo aparte que decide el usuario.
  - **M4**: D14 aplica a la base real; los tests usan ids visiblemente ficticios que nunca van al seed.
  - **M5**: orden en `createEpisode` (Zod → chequeo de voces → primer insert), candidatos resueltos por `role`, y una fila `Agent` faltante cuenta como agente sin voz (nuevo edge case).
  - **m1**: estado "implementada en parte" (pasos 3 y 5a, marcados como hechos en el Plan). **m2**: razón de D3 reformulada. **m3**: AC 4.29 conserva su test de integración después de la mejora. **m4**: AC 4.29 se cierra en el paso 7 con una llamada HTTP real (se quitó del smoke del paso 8). **m6**: los tests de integración `ES` cargan filas `AgentVoice` `ES`/`LOCAL`.
