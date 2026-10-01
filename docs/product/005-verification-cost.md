# 005 — Costo de la verificación de argumentos (fact-check y loop de enmienda)

Estado: **especificada por `product-analyst` y revisada por `architect` (2026-10-01): aprobada con cambios, aplicados.** Las decisiones del usuario sobre P1, P3, P4, P5, P6 y P7 están incorporadas. Sin implementar. Los mecanismos técnicos están en dos ADR, todavía **propuestos** (falta la aceptación del usuario):

- **ADR 0003** (`docs/adr/0003-verificacion-en-lote-proveedor-fijo.md`): verificación en lote, verificador fijo, claims versionados y lote inválido.
- **ADR 0004** (`docs/adr/0004-registro-por-llamada-llm.md`): registro por llamada LLM.

Las decisiones marcadas **fija** salen de restricciones o decisiones del usuario, de specs anteriores o de la revisión de `architect`, y no se reabren acá. Las marcadas **decidido por defecto, revisable** son defaults razonables que se pueden cambiar sin rehacer la spec. Esta spec define resultados y límites medibles; los mecanismos se citan de los ADR, pero no se diseñan acá.

## Contexto

### El problema

Con el diseño actual, **un episodio con la configuración por defecto no puede terminar con el presupuesto por defecto**. El costo en llamadas LLM no lo determina el debate, sino la cantidad de claims que el extractor saca de cada borrador, y ese número no está acotado.

Caso real (verificado el 2026-10-01 sobre `dev.db`): episodio `7d2cee7d-1d16-427b-bf98-b285eb3e88a5`, en `ES`, con 1 opening, 1 rebuttal y 1 cross-examination. Contrarian corre en `GOOGLE`, Analyst en `OPENROUTER` y el juez en `GOOGLE`. El episodio gastó **50 llamadas LLM** (el límite por defecto es 25; el curador reanudó con 50), produjo **1 solo argumento `OFFICIAL`** y terminó en `FAILED` porque `USAGE_LIMIT_EXCEEDED` se repitió.

### Cómo se gasta hoy (`episode-orchestrator.service.ts`, `processDraft`, ~:320-417)

Cada vuelta de verificación de un borrador hace:

- 1 llamada `extractClaims`, con el proveedor del debatiente;
- **1 llamada por claim**, todas en paralelo: los `FACTUAL` van a `check` (con el proveedor del debatiente) y los `OPINION`/`SUBJECTIVE`/`PREDICTION` van a `editorialReview` (siempre `GOOGLE`, `decision-log.md` #14);
- 1 llamada `amend` si algo falla, y después la vuelta se repite **entera** hasta `maxRevisionAttempts` (3).

Los modelos extraen unos 10 claims por argumento. En el caso real: Contrarian 14 (solo 4 factuales); los borradores del Analyst 10 y 28, con 28 claims acumulados en 3 vueltas y claims duplicados que se volvieron a verificar.

| | Llamadas aproximadas |
|---|---|
| Un argumento que pasa en la primera vuelta | 1 generación + 1 extracción + ~10 verificaciones ≈ **12** |
| Cada vuelta de enmienda | 1 `amend` + 1 extracción + ~10 verificaciones ≈ **12** |
| Episodio por defecto (research + 6 argumentos + veredicto), sin ninguna enmienda | 1 + 6 × 12 + 1 ≈ **74** |
| `maxLlmCalls` por defecto (`schema.prisma`, `features.md` Feature 2) | **25** |

`decision-log.md` #11 ya había visto este síntoma (25/25 en un solo argumento) y decidió no subir el default "para no esconder el síntoma". Esta spec ataca la causa.

### Multiplicadores observados

1. **Cada enmienda vuelve a extraer y a verificar todos los claims**, no solo los que fallaron.
2. **La enmienda recibe solo la primera falla** (`failureIndex`, `:359`). Con 3 problemas hacen falta 3 vueltas, cada una de unas 12 llamadas.
3. **`UNSUPPORTED` cuenta como falla** (`isFactCheckFailure`, `:92`, `decision-log.md` #17) **y se aplica a interpretaciones mezcladas con hechos**: "lo que indica una estrategia de expansión coordinada", "un despliegue muy específico". Lo resuelven D9 y D17. Además hubo un **falso negativo**: se marcó `FALSE` "primera vez en un estadio de fútbol en Argentina", aunque la fuente (consequence.net) lo dice literalmente; el verificador confundió el Estadio Obras (2005) con un estadio de fútbol. **Diagnóstico (P8, resuelta):** el respaldo estaba en la Evidence Base que ve el verificador. Uno de los `EvidenceFact` de la fuente `508b2eb7` (tópico `f748c653…`) dice literalmente que el show en el Estadio Huracán "representa la primera vez que la banda se presenta en un estadio de fútbol en Argentina", y otro menciona los shows en el Estadio Obras de 2005. El verificador tenía la evidencia literal y razonó mal. Ese `check` lo hizo el proveedor del Analyst (`OPENROUTER`). El modelo concreto no quedó registrado (`LlmRequestLog` solo guarda el proveedor y la fecha), así que es probable, pero no está confirmado, que haya sido el de 2,6B.
4. **Modelo de 2,6B en el sorteo de OpenRouter.** `ModelProviderFactory.resolve("OPENROUTER")` (`model-provider.factory.ts:68-69`) sortea en **cada llamada** entre `nvidia/nemotron-3-super-120b-a12b:free` y `liquid/lfm-2.5-2.6b:free`. Como `extractClaims` y `check` usan el proveedor del debatiente, ese modelo no solo escribe los borradores del Analyst: también extrae y verifica sus claims. Los borradores del Analyst llegan al tope de 2000 caracteres de `ArgumentDraftSchema` (`agents.contracts.ts:49-51`); uno termina cortado en "yno"; empiezan con "Hola. He analizado…" y meten UUIDs de fuentes en el texto (problema ya anotado en `decision-log.md` #12 y no resuelto: `formatEvidence` en `agents.service.ts:57` muestra `(fuente: {sourceId})`). Más texto implica más claims, y más claims, más llamadas.

### Desperdicio puntual

- **Borrador huérfano al reanudar.** Después del primer `USAGE_LIMIT_EXCEEDED`, el pipeline creó un borrador nuevo del Analyst (`68f54f4d`) en lugar de continuar el `DRAFT` existente (`29a24266`, en el que ya se habían gastado ~11 llamadas). Causa en el código: `runRound` solo saltea a los agentes con un argumento `OFFICIAL` en la ronda (`:428-438`) y vuelve a llamar a `argue`/`respond` aunque ya exista un `DRAFT`.
- **Sin medición de tokens.** `EpisodeUsage.inputTokens`/`outputTokens` siempre valen 0, aunque `features.md` Feature 2 exige registrarlos ("El sistema registrará de forma transaccional: llmCalls, inputTokens, outputTokens…"). Es un requisito del MVP congelado que no se cumple.
- **Sin registro del modelo concreto.** Con `OPENROUTER`, el modelo se sortea en cada llamada y no queda guardado en ningún lado. Por eso no se puede atribuir un error de verificación (como el del Estadio Obras) a un modelo.

## Personas

- **Curador**: el dueño del proyecto (spec 003). Crea episodios, ve el consumo contra los límites (AC 3.30) y resuelve los checkpoints (AC 3.51). Hoy tiene que subir el presupuesto de casi todos los episodios, y aun así pueden terminar en `FAILED`.
- **Audiencia del episodio**: no ve el pipeline, pero escucha los argumentos. Un UUID o un "Hola. He analizado…" en el texto llega al TTS.

## Decisiones

Cada decisión incluye su razón. Una alternativa propuesta durante la implementación tiene que refutar esa razón, no solo ofrecer otra opción.

### Restricciones que no se negocian

- **D1. El fact-check sigue siendo una condición previa para `OFFICIAL` (fija, usuario).** Ningún argumento pasa a `OFFICIAL` por el pipeline sin que todos los claims `FACTUAL` de su versión final tengan un resultado de verificación y ninguno bloquee según D17. El texto no factual también sigue pasando por el filtro editorial. Razón: es la promesa del producto (`features.md` Feature 3, "debates verificados").
- **D2. No cambian los contratos que consume el dashboard (fija, usuario).** Se mantienen sin cambios el enum `CheckpointReason`, los campos de `usage` y `limits` de `getEpisodeDetail`, los tipos de eventos SSE y sus payloads (`fact_check.completed` sigue siendo `{ status: PASSED|FAILED, errorsDetected }`) y los paneles de resolución (AC 3.51). `openapi.json` no cambia. Si en la revisión resulta que algo tiene que cambiar, se trata como una decisión explícita y se lista en "Dependencias" para que se integre en la spec 003.
- **D3. Todo lo nuevo respeta el idioma del episodio (fija, spec 004).** Las llamadas evaluadoras que se agreguen o fusionen, y la enmienda con varias fallas, llevan la instrucción de idioma y escriben sus campos libres en el idioma del episodio (spec 004, D7, D11, AC 4.6 y 4.7).
- **D4. La unidad del presupuesto sigue siendo la llamada (fija, `features.md` Feature 2).** `llmCalls` cuenta los pedidos al proveedor que pasan por el presupuesto del episodio, igual que hoy: una verificación en lote cuenta como una llamada, y los reintentos de resiliencia de una misma llamada no se cuentan dos veces. Una llamada que termina fallando devuelve su cupo, como hoy. Razón: es lo que ve el curador y lo que limita `maxLlmCalls`. Los tokens se registran (D10), pero no limitan nada.
- **D5. Se conserva la trazabilidad de Feature 10 y AC 1.2 (fija, `features.md`).** Cada claim `FACTUAL` verificado sigue teniendo su `FactCheck`, con veracidad, análisis y al menos una `Source`, aunque se haya verificado en lote o se haya reutilizado un resultado anterior. Un resultado reutilizado se guarda como copia y registra de qué `FactCheck` salió (ADR 0003, punto 9).

### Costo

- **D6. Verificar un borrador cuesta como máximo 3 llamadas, en serie y siempre con `GOOGLE` (fija; P2 y P4 resueltas; ADR 0003, puntos 1 y 2).**
  - **Qué llamadas.** Cada versión de un borrador se verifica con 3 llamadas como máximo, sea cual sea la cantidad de claims:
    1. extracción, que clasifica el tipo de cada claim y, en los `FACTUAL`, si son dato concreto (D17);
    2. verificación de los hechos pendientes, en un solo lote;
    3. revisión editorial de los claims no factuales, en un solo lote y con el argumento completo.
  - **Cuándo se omite una llamada.** Si una versión no tiene claims de un tipo, la llamada que corresponde se omite.
  - **Orden.** Las 3 llamadas corren en serie, sin paralelismo: si una frena por presupuesto o por el proveedor, la siguiente no arranca.
  - **Verificador fijo.** Las 3 llamadas usan siempre `GOOGLE`, sea cual sea el proveedor del debatiente. Esto amplía `decision-log.md` #14, que solo fijaba la revisión editorial.
  - **Referencias cortas.** Los prompts de verificación identifican los claims y los hechos con referencias cortas (`C1..Cn`, `E1..Em`), nunca con UUIDs.
  - **Sin pasos fusionados en el MVP.** Fusionar los hechos y la editorial en una sola llamada queda como respaldo, solo si AC 5.6 no llega a 6 llamadas o menos por argumento.
  - **Razón.** El multiplicador principal era el costo por claim. Con un verificador fijo, la calidad del control deja de depender del modelo que le toque al debatiente (P8).
- **D7. Una sola enmienda por vuelta, con todas las fallas (decidido por defecto, revisable).** Cuando una vuelta encuentra fallas, el debatiente recibe en una sola llamada `amend` **todas** las fallas de esa vuelta, cada una con el claim y el motivo. Pueden ser factuales, editoriales o de formato (D13). El contrato interno pasa a una lista de fallas (`AmendmentFeedback.failures[]`, ADR 0003, punto 4). Razón: con la primera falla sola, 3 problemas consumen 3 vueltas y llegan a `MAX_REVISIONS_EXCEEDED` aunque el debatiente pudiera corregirlos todos juntos.
- **D8. En una vuelta de enmienda no se vuelve a verificar lo que ya pasó (decidido por defecto, revisable).**
  - **Qué se reutiliza.** Un claim `FACTUAL` que ya pasó en una vuelta anterior del mismo argumento, y que aparece sin cambios en la versión enmendada, reutiliza su resultado.
  - **Qué es "sin cambios".** El mismo `statement` normalizado, con igualdad exacta. Cualquier diferencia de texto se vuelve a verificar (ADR 0003, punto 9).
  - **Qué no se reutiliza.** Lo que es nuevo, lo que cambió y lo que había fallado se verifica de nuevo.
  - **Revisión editorial.** Se rehace en cada vuelta, porque evalúa el claim en el contexto del argumento completo (`decision-log.md` #12) y ese contexto cambió.
  - **Razón.** Re-verificar lo ya aprobado no agrega garantía y cuesta llamadas o tokens. Que un claim que falló se re-verifique, en vez de reutilizar la falla, le da una segunda oportunidad a un falso negativo como el del Estadio Obras.
  - **Evidence Base.** No hace falta compararla: no cambia durante `DEBATING`.
- **D9. El extractor separa hecho de interpretación y no duplica (decidido por defecto, revisable; el usuario confirmó que se mantiene junto con D17).** En una oración que mezcla un dato verificable con una interpretación, el dato se extrae como `FACTUAL` y la interpretación como `OPINION`/`SUBJECTIVE`. Dentro de una misma versión, un mismo enunciado (`statement` normalizado) se extrae una sola vez. Razón: las interpretaciones terminan hoy en `UNSUPPORTED` (multiplicador 3) y disparan enmiendas que no corrigen ningún dato falso. Separarlas mantiene el control sobre la parte factual. **No** se impone un tope duro de claims: un tope dejaría claims factuales sin verificar y violaría D1. Con D6, la cantidad de claims deja de multiplicar llamadas.
- **D10. Se registran los tokens y el modelo concreto de cada llamada LLM (fija tras la revisión; ADR 0004).**
  - **Tokens en `EpisodeUsage`.** Se suman a `inputTokens`/`outputTokens`, lo que cumple el requisito pendiente de `features.md` Feature 2. Suman **todos los intentos**, también los reintentos fallidos, porque son costo real. Por eso no equivalen exactamente a "tokens de las llamadas contadas en `llmCalls`".
  - **Una fila por llamada en la tabla nueva `EpisodeLlmCall`.** Registra la operación, el proveedor, el modelo concreto (`modelId`), los intentos, si salió bien y los tokens. **No** se registra en `LlmRequestLog`, que es el estado del limitador: se escribe antes de la llamada y se borra a las 48 h.
  - **Exposición.** Nada de esto se expone en la API ni en el dashboard en esta spec (D2).
  - **Razón de los tokens.** Verificar en lote cambia muchas llamadas chicas por pocas grandes, y sin tokens no se puede saber si el ahorro en llamadas se paga con prompts mucho más grandes.
  - **Razón del modelo.** Sin ese dato no se puede atribuir un error de verificación a un modelo (el caso del Estadio Obras quedó sin confirmar por eso). Además, AC 5.6, 5.12, 5.14, 5.16 y 5.24 piden resultados por modelo.
- **D11. El `maxLlmCalls` por defecto se vuelve a calibrar después de medir (fija, usuario, P3 resuelta).**
  - **Qué cubre:** el costo de un episodio por defecto sin enmiendas, más un margen para vueltas de enmienda en todo el episodio.
  - **Cuándo se fija:** **después** de los smoke tests de AC 5.6, con el costo medido, nunca antes.
  - **Referencia orientativa** (de las cuentas de P2): unas 40 llamadas con 3 llamadas de verificación, o unas 30 si en algún momento se fusionan pasos, con un margen de unas 3 vueltas. No son el valor final.
  - **A quién aplica:** solo a los episodios nuevos; los existentes conservan sus límites.
  - **Nota técnica (de la revisión de `architect`):** cambiar el `@default(25)` de `Episode.maxLlmCalls` en SQLite obliga a reconstruir la tabla `Episode`. La alternativa es fijar el valor como constante en `createEpisode`. Lo decide quien planifique o implemente; para esta spec, las dos opciones son equivalentes.
  - **Razón:** la lección de #11 (no subirlo para esconder el síntoma) sigue en pie, y esta spec ataca primero la causa.

### Criterio de falla factual

- **D17. `UNSUPPORTED` bloquea solo si el claim afirma un dato concreto (fija, usuario, P1 resuelta, opción b).** Reemplaza en parte la decisión de `decision-log.md` #17: adopta la opción 3 que #17 había descartado por falta de un segundo caso real.
  - **Qué es un dato concreto.** Un claim `FACTUAL` lo afirma si contiene al menos uno de estos elementos como parte de lo que se afirma:
    1. **Cifra**: un número, cantidad, porcentaje, monto, puntaje, rating, ranking o posición. Ejemplos: "78 %", "9,1 en MyAnimeList", "el tercero más visto".
    2. **Fecha o período identificable**, absoluto o relativo, que ubique el hecho en el tiempo. Ejemplos: "en 2005", "el 8 de septiembre", "el año pasado".
    3. **Nombre propio que forma parte del hecho**: persona, organización, lugar, obra, producto, evento o fuente citada. Ejemplos: "Estadio Huracán", "según Billboard".
    4. **Récord, primicia, superlativo o exclusividad verificable**. Ejemplos: "la primera vez", "el único", "el más vendido".
    5. **Hecho puntual atribuido**: que un actor identificable hizo, dijo, anunció o publicó algo determinado.
  - **Qué es una afirmación general o interpretativa.** Es un claim `FACTUAL` sin ninguno de esos elementos: tendencias, generalizaciones, valoraciones o lecturas de los hechos. Ejemplos: "la industria se está consolidando", "lo que indica una estrategia de expansión coordinada", "un despliegue muy específico".
  - **Regla de bloqueo:**

    | Resultado de la verificación | Dato concreto | Afirmación general |
    |---|---|---|
    | `FALSE`, `MISLEADING` | bloquea | bloquea |
    | `UNSUPPORTED` | **bloquea** | **no bloquea** |
    | `TRUE`, `CONTESTED` | no bloquea | no bloquea |

  - **Qué pasa con un `UNSUPPORTED` que no bloquea.** No dispara enmienda y no cuenta en `errorsDetected`. Su `FactCheck` igual se persiste con `UNSUPPORTED` (D5), para auditoría.
  - **Trazabilidad.** La clasificación queda guardada por claim en `Claim.specificity` (`CONCRETE`/`GENERAL`, solo en los `FACTUAL`), en la base y sin exponerla en la API (D2).
  - **Quién clasifica.** La hace la extracción (D6). Hay además una red determinística: si el `statement` tiene un dígito, se fuerza `CONCRETE`. Nunca se fuerza `GENERAL` (ADR 0003, punto 7).
  - **Relación con D9.** D9 se mantiene igual: separa la interpretación del dato antes de verificar. D17 cubre lo que D9 no logre separar.
  - **Lo que D17 no resuelve.** El caso del Estadio Obras **no** lo cubre D17: fue un `FALSE` por mal razonamiento del verificador, no un `UNSUPPORTED`, y `FALSE` bloquea siempre. Lo cubren el verificador fijo (D6) y el conjunto de referencia (AC 5.12).
  - **Razón.** El problema de #17 eran cifras inventadas (ratings de MyAnimeList), y eso sigue bloqueando (AC 5.23). Las interpretaciones sin respaldo, en cambio, disparaban enmiendas que no corregían ningún dato y consumían presupuesto.
  - **Asimetría aceptada.** Clasificar como dato concreto algo que era general solo cuesta una enmienda de más. Clasificar como general algo que era un dato concreto deja pasar un posible dato inventado. Por eso AC 5.23 exige 0 errores en esa dirección.

### Modelos y calidad del texto

- **D12. El modelo `liquid/lfm-2.5-2.6b:free` sale de todo el pipeline (fija, usuario, P5 resuelta).** No se usa en ninguna llamada: ni de generación, ni de extracción, ni de verificación, ni del veredicto, ni del research. `OPENROUTER` queda solo con `nvidia/nemotron-3-super-120b-a12b:free`, hasta que se valide un reemplazo como trabajo aparte. Con D6, `OPENROUTER` ya no participa de la verificación: solo genera los argumentos del debatiente que lo tenga asignado, y el veredicto si le toca al juez. Razón: además de escribir borradores largos, cortados y con metatexto, hoy ese modelo extrae y verifica los claims del debatiente que le toca (multiplicador 4). El caso del Estadio Obras muestra que un verificador que razona mal sobre evidencia literal rompe el control. Cuesta parte de la diversidad que motivó sumar OpenRouter (`decision-log.md` #13).
- **D13. Los argumentos `OFFICIAL` no contienen identificadores internos (fija por su impacto en la audiencia).** Ni UUIDs de fuentes ni de agentes. Razón: el TTS los lee en voz alta, y además agregan claims y tokens. Es el pendiente de `decision-log.md` #12.

  **Mecanismo (de la revisión de `architect`):**
  - **Prevención.** El debatiente deja de ver los `sourceId`: `formatEvidence` de `agents.service.ts` ya no los muestra.
  - **Control antes de extraer.** Antes de la extracción, un chequeo determinístico busca UUIDs en el texto, sin llamadas LLM.
  - **Si encuentra uno.** La vuelta termina ahí y el debatiente enmienda con una falla de formato (`FORMAT_VIOLATION`). Esa vuelta consume una enmienda como cualquier otra falla, y `fact_check.completed` sale con `status: FAILED` y `errorsDetected: 1`.
- **D14. Los argumentos no traen metatexto dirigido al sistema ni terminan cortados (decidido por defecto; se mide, no se valida en el MVP).** Por ejemplo, "Hola. He analizado la evidencia…" o un final como "yno". Se ataca desde la instrucción al debatiente y se mide en los smoke tests. Si la medición muestra que sigue ocurriendo, la validación pasa a ser trabajo aparte que decide el usuario (mismo criterio que spec 004, D10).
- **D18. Largo objetivo de un argumento: unos 800-1200 caracteres (fija, usuario, P7 resuelta).**
  - **Cómo se pide.** Es una instrucción en el prompt de toda llamada que produce el texto de un argumento: `argue`, `respond`, `amend` y el `regenerate` del curador. Rige igual para los tres tipos de ronda y los tres idiomas.
  - **Límite duro.** El tope de 2000 caracteres de `ArgumentDraftSchema` sigue siendo el límite duro, sin cambios.
  - **Qué no se hace.** El rango es un objetivo, no una validación: un argumento fuera del rango no se rechaza ni dispara una enmienda. Se mide en los smoke tests (AC 5.24).
  - **Idioma.** La instrucción de largo convive con la instrucción de idioma de la spec 004 (D11, AC 4.6), que sigue igual: como regla del system prompt y como última línea del prompt de usuario. El prompt sigue en español neutro.
  - **Razón.** Los borradores que llenan los 2000 caracteres generan más claims y más tokens, terminan cortados (D14), dejan poco margen a una enmienda que tiene que atender varias fallas (D7) y alargan el audio.

### Recuperación

- **D15. Al reanudar o recuperar, se continúa el `DRAFT` existente y su vuelta a medio verificar (fija tras la revisión; ADR 0003, punto 8).**
  - **Cuándo aplica.** Al retomar `DEBATING`, por `resume` o por `EpisodeRecoveryService`, cuando un agente ya tiene un `DRAFT` en la ronda en curso.
  - **Qué se hace.** No se genera un borrador nuevo: se retoma el más reciente, con su contenido vigente.
  - **Vuelta a medio verificar.** Si la versión vigente ya tiene claims, no se vuelve a extraer. Se verifican solo los claims `FACTUAL` de esa versión que todavía no tienen resultado, y la revisión editorial se rehace (no se persiste). Por ejemplo, reanudar después de un corte en el `amend` cuesta 1 llamada (la editorial) en vez de 3.
  - **Razón.** En el caso real se perdieron unas 11 llamadas y el borrador viejo quedó huérfano. Es justo el camino que el curador recorre después de un `USAGE_LIMIT_EXCEEDED` o de un `PROVIDER_QUOTA_EXCEEDED`.
  - **Qué no cambia.** Después de `MAX_REVISIONS_EXCEEDED`, el argumento queda `REJECTED` y al reanudar se genera uno nuevo, como hoy.
- **D16. Las enmiendas ya hechas cuentan para `maxRevisionAttempts` al reanudar y al recuperar (fija, usuario, P6 resuelta).** Un borrador que ya gastó 2 de 3 enmiendas antes del corte conserva 1 sola, tanto si se reanuda (`resume`, también después de que el curador subió el presupuesto) como si lo retoma `EpisodeRecoveryService` después de un reinicio. El conteo sale de `Argument.revision`, una columna persistida, con backfill para los argumentos existentes (ADR 0003, punto 7). Razón: si no, cada reanudación daría 3 intentos nuevos sin que nadie lo decida, y el límite dejaría de significar algo.
- **D19. Un lote de verificación inválido no castiga al debatiente (fija, P9 resuelta; ADR 0003, puntos 5 y 6).**
  - **Qué es un lote válido.** Cada claim pendiente (`claimRef`) aparece exactamente una vez.
  - **Referencias que no existen.** Las de claims (`claimRef`) y las de evidencia (`evidenceRef`) se descartan. Si un resultado factual queda sin ninguna evidencia, el lote es inválido.
  - **Qué pasa con un lote inválido.** Se reintenta dentro de la misma llamada contada (D4), igual que una respuesta que no se puede leer.
  - **Si se agotan los reintentos.** Ese fallo, y cualquier otro fallo final de las 3 llamadas de verificación que no sea de cuota o de espera del limitador, sale como `VerificationUnavailableError`. El episodio pasa a `REQUIRES_HUMAN_REVIEW` con el motivo existente `PROVIDER_QUOTA_EXCEEDED`.
  - **Qué no se toca.** No consume enmienda, la llamada devuelve su cupo (D4), el `DRAFT` queda como estaba y se retoma al reanudar (D15) con su conteo de enmiendas (D16). No se agrega ningún `CheckpointReason` (D2).
  - **Descartadas:**
    - contarlo como enmienda, porque castiga al debatiente por un error del verificador;
    - `VALIDATION_INCONSISTENCY`, porque su panel deshabilita "Reanudar" (AC 3.51);
    - un motivo nuevo, porque rompe D2.

## No-objetivos

Fuera de alcance. Si algo de esto parece necesario, parar y preguntar:

- **Eliminar o relajar el fact-check** como condición previa para `OFFICIAL` (D1), o dejar claims factuales sin verificar para ahorrar llamadas. D17 no es una excepción: los `UNSUPPORTED` generales se siguen verificando y auditando; lo único que cambia es que no bloquean.
- **Cambiar el tratamiento de `CONTESTED`**: sigue pasando (`decision-log.md` #17).
- **Fact-check en el `regenerate` del curador**: sigue sin verificar (spec 003, AC 3.45). Solo recibe la instrucción de largo (D18).
- **API-20** (`executionTime` nunca se escribe) y **API-21** (los errores de red del proveedor caen en "error no clasificado"), en `tasks.md` §12. Esta spec solo los cita como referencia. D19 cubre los fallos finales de las 3 llamadas de verificación, incluidos los de red, pero no los de generación, research ni veredicto, que siguen en API-21.
- **Exponer los tokens o el modelo por llamada** en `usage`, en `openapi.json` o en el dashboard (D2, D10). Queda como nice-to-have.
- **Costo en dinero** (USD por episodio) o precios por proveedor.
- **UI de auditoría** de claims y fact-checks (spec 003, API-3; Feature 10 P1).
- **Cambiar las reglas editoriales de las personas**, el research (Tavily, `maxSearchQueries`) o los límites de TTS.
- **Agregar proveedores o modelos pagos**, o reemplazar el modelo que sale (D12) por otro nuevo. Si hace falta un reemplazo, es trabajo aparte y lo valida un script, como en `decision-log.md` #13.
- **Validar el idioma de la salida** (spec 004, D10), ni **validar el largo** de los argumentos (D18).
- **Editar `features.md`** (congelado). El cambio de default de D11 y el registro de tokens se documentan como extensión en `decision-log.md`, con el mismo precedente que `audioUrl` (#27).

## User stories

- **US 5.1**: como curador, quiero que un episodio con la configuración por defecto llegue a `PENDING_REVIEW` con el presupuesto por defecto, para no tener que subir el límite en casi todos los episodios.
- **US 5.2**: como curador, quiero que el costo de un argumento dependa de cuántas veces hay que corregirlo y no de cuántas oraciones tiene, para poder anticipar cuánto va a costar un episodio.
- **US 5.3**: como curador, quiero que un argumento con varios problemas se corrija en una sola vuelta, para que no llegue a `MAX_REVISIONS_EXCEEDED` por problemas que el debatiente podía corregir juntos.
- **US 5.4**: como curador, quiero que un argumento no se rechace por una interpretación razonable de un dato cierto ni por un error del verificador, sin que pasen datos inventados que hoy se detectan.
- **US 5.5**: como curador, quiero que al reanudar un episodio después de subir el presupuesto se continúe el trabajo que quedó a medias, en vez de pagarlo de nuevo.
- **US 5.6**: como curador, quiero saber cuántos tokens consumió cada episodio y qué modelo atendió cada llamada, para comparar el costo real antes y después de esta spec y atribuir errores de verificación a un modelo.
- **US 5.7**: como audiencia, quiero escuchar argumentos de largo parejo, sin identificadores internos, saludos al sistema ni frases cortadas.

## Criterios de aceptación

Se numeran `AC 5.x`, por esta spec 005. No se confunden con las user stories "US 5.x" internas de la sección 5 de la spec 003. Los AC de backend se verifican con tests con el LLM mockeado: se verifica cuántas llamadas se hacen y qué recibe el proveedor, no la calidad de su salida. La calidad se verifica con el conjunto de referencia (AC 5.12) y los smoke tests reales (`scripts/smoke-test-episode.ts` o equivalente), con modelos reales. Los AC agregados después de la primera versión van a partir del 5.22, para no renumerar.

### Costo

- **AC 5.1**: verificar una versión de un borrador cuesta como máximo 3 llamadas LLM contadas en `llmCalls`, en serie y todas con `GOOGLE` (D6). Ese número es el mismo para borradores con 1, 10 y 30 claims, con cualquier mezcla de tipos. Si una versión no tiene claims de un tipo, no se hace la llamada que corresponde a ese tipo. Si una llamada frena (presupuesto o proveedor), la siguiente no se hace. Se verifica con tests del orquestador que cuentan las llamadas y el proveedor con el LLM mockeado.
- **AC 5.2**: un argumento que pasa en la primera vuelta consume como máximo 4 llamadas: la generación más la verificación de AC 5.1. Cada vuelta de enmienda suma como máximo 4: un `amend` más la verificación.
- **AC 5.3**: en una vuelta con N fallas (N ≥ 2, factuales, editoriales o mezcladas), se hace una sola llamada `amend`, y el feedback que recibe el debatiente contiene las N fallas, cada una con el claim y el motivo, en el idioma del episodio (D3, D7). Se verifica con tests que inspeccionan lo que recibe `amend`.
- **AC 5.4**: en una vuelta de enmienda, los claims `FACTUAL` que ya pasaron en una vuelta anterior del mismo argumento y siguen sin cambios (mismo `statement` normalizado) no se envían otra vez a verificar. Si la versión enmendada no tiene ningún claim `FACTUAL` nuevo, cambiado ni previamente fallado, no se hace la llamada de verificación factual y no se gasta presupuesto. La revisión editorial se hace en cada vuelta (D8). Se verifica con tests.
- **AC 5.5**: dentro de una misma versión no se verifica dos veces el mismo enunciado (D9). Se verifica con un test cuya extracción devuelve claims duplicados.
- **AC 5.6**: **smoke test de costo.** Se corren al menos 3 episodios reales `ES` con la configuración por defecto (1 opening, 1 rebuttal y 1 cross-examination), y uno de ellos usa el mismo tópico del episodio `7d2cee7d`. Para cada uno se registran en `decision-log.md` estos datos: `llmCalls` total, llamadas por argumento `OFFICIAL`, vueltas de enmienda por argumento, tokens (AC 5.8), proveedores y modelos que atendieron las llamadas (tomados de `EpisodeLlmCall`). Se registra también el estado final. Se cumple si:
  - ningún episodio termina en `USAGE_LIMIT_EXCEEDED` con el `maxLlmCalls` por defecto nuevo (AC 5.7);
  - el promedio de llamadas por argumento `OFFICIAL` es como máximo 6 (objetivo revisable: 4 sin enmiendas y 8 con una). Si no se llega, se evalúa fusionar los hechos y la editorial (D6);
  - si algún episodio frena por `MAX_REVISIONS_EXCEEDED`, se documenta el motivo de cada falla. Eso no hace fallar este AC, pero sí cuenta para AC 5.12.
- **AC 5.7**: el `maxLlmCalls` por defecto de los episodios nuevos se fija con los números de AC 5.6 (D11). Tiene que alcanzar para un episodio por defecto sin enmiendas, medido, más el margen de vueltas de enmienda que se elija al fijarlo (unas 40 o unas 30 llamadas son solo referencias orientativas). El valor y su cálculo quedan en `decision-log.md`, y se documenta como extensión del valor de `features.md`. Si se aplica cambiando el `@default` del schema, la reconstrucción de la tabla `Episode` conserva los datos; si se aplica como constante en `createEpisode`, el `@default` puede quedar. Los episodios ya creados conservan su `maxLlmCalls`. Se verifica con una consulta directa a la base antes y después.
- **AC 5.8**: **tokens y modelo por llamada** (D10, ADR 0004).
  - **Una fila por llamada.** Cada llamada LLM que pasa por el presupuesto del episodio, salga bien o mal, deja una fila en `EpisodeLlmCall` con la operación, el proveedor, el `modelId` concreto (el modelo que atendió la respuesta), los intentos, si salió bien y los tokens. La única excepción es una llamada que falla antes de llegar al modelo.
  - **Tokens.** `EpisodeUsage.inputTokens`/`outputTokens` suman los tokens de todos los intentos, incluidos los reintentos fallidos, cuando el proveedor los informa.
  - **Después de un smoke test.** Los dos totales de tokens son mayores que 0, y ninguna fila de `EpisodeLlmCall` del episodio tiene el `modelId` vacío.
  - **Lo que no se toca.** `LlmRequestLog` no cambia, y los campos de `usage` en `getEpisodeDetail` tampoco (D2).
  - **Cómo se verifica.** Con tests que simulan la respuesta del proveedor con y sin datos de tokens, con un reintento fallido, y que verifican el `modelId` registrado; y con una consulta a la base después del smoke.

### Calidad y condición previa del fact-check

- **AC 5.9**: un borrador no pasa a `OFFICIAL` si algún claim `FACTUAL` de su versión final no tiene resultado de verificación, o si tiene un resultado que bloquea según D17. Cuando el lote de verificación viene mal, se aplica D19:
  - si faltan resultados, sobran o algún resultado no corresponde a ningún claim, el lote es inválido y se reintenta;
  - si una `evidenceRef` no existe, se descarta; si un resultado queda sin ninguna evidencia, el lote es inválido;
  - en ningún caso un resultado faltante o descartado cuenta como aprobado.

  Se verifica con tests con respuestas mockeadas incompletas, con un `FALSE` entre 10 `TRUE`, con un resultado que no corresponde a ningún claim y con una `evidenceRef` inexistente (sola y junto a una válida).
- **AC 5.10**: cada claim `FACTUAL` de la versión final de un argumento que **el pipeline promovió** a `OFFICIAL` tiene un `FactCheck` persistido con veracidad, análisis y al menos una `Source` (D5). Esto vale también para los claims cuyo resultado se reutilizó (AC 5.4) y para los `UNSUPPORTED` generales que no bloquearon (D17). No aplica a los argumentos que pasaron por `regenerate` o `edit`: no se verifican (spec 003, AC 3.45) y no tienen claims de su versión vigente. Se verifica con un test de integración y con una consulta después del smoke.
- **AC 5.11**: en el conjunto de referencia (AC 5.12), las dos interpretaciones del caso real ("lo que indica una estrategia de expansión coordinada" y "un despliegue muy específico") no producen ningún claim `FACTUAL` con resultado `UNSUPPORTED`. Si la oración contiene un dato verificable, ese dato sí se extrae como `FACTUAL` y se verifica (D9).
- **AC 5.12**: **conjunto de referencia (sin regresión).**
  - **Qué contiene**: antes de implementar se arma un conjunto de claims reales, con su Evidence Base y el resultado esperado. Cada claim `FACTUAL` lleva una etiqueta manual, "dato concreto" o "afirmación general", según la definición de D17. Como mínimo incluye:
    - las cifras inventadas de MyAnimeList que hoy se detectan (`decision-log.md` #17);
    - el claim del Estadio Obras, con la Evidence Base real de la fuente `508b2eb7` (tópico `f748c653…`): el `EvidenceFact` que respalda literalmente "la primera vez que la banda se presenta en un estadio de fútbol en Argentina" y el que menciona el Estadio Obras en 2005;
    - las dos interpretaciones de AC 5.11;
    - una muestra de claims `TRUE` reales;
    - al menos un `UNSUPPORTED` general y al menos uno con dato concreto, para AC 5.23.
  - **De dónde salen**: de episodios de `dev.db`. Si alguno ya no existe, se documenta con qué se reemplazó.
  - **Cuándo y cómo se corre**: con modelos reales, antes del cambio (línea de base) y después. La línea de base incluye el verificador nuevo, `GOOGLE` (`gemini-3.5-flash-lite`), corriendo sobre el mismo conjunto, y conviene medir también `nemotron` como comparación.
  - **Cuándo se cumple**:
    - todo claim que hoy se detecta correctamente como falla, y que según D17 sigue bloqueando, sigue fallando (0 regresiones);
    - el claim del Estadio Obras sale `TRUE` y no bloquea. El respaldo está en la Evidence Base que recibe el verificador (P8, resuelta). Este caso lo cubren el verificador fijo (D6) y este AC, no el criterio de D17. **Si `GOOGLE` falla este caso en la línea de base, se frena y decide el usuario** antes de implementar (ver "Riesgos");
    - las interpretaciones cumplen AC 5.11;
    - se cumple AC 5.23;
    - los claims `TRUE` de la muestra pasan.
  - **Registro**: los resultados, por proveedor y modelo, van a `decision-log.md`. Si un claim falla, el registro dice qué modelo lo verificó. No hay umbral automático para la muestra `TRUE`: cualquier rechazo se analiza a mano.
- **AC 5.13**: `MAX_REVISIONS_EXCEEDED` y `USAGE_LIMIT_EXCEEDED` conservan su significado. El primero ocurre, como hoy, cuando un borrador ya recibió `maxRevisionAttempts` enmiendas y la verificación de su última versión sigue con fallas. Cuentan también las enmiendas anteriores a una reanudación o a una recuperación (D16) y las de formato (D13). El segundo ocurre antes de una llamada que superaría `maxLlmCalls`. Una llamada de verificación que no se hace por falta de presupuesto no deja ningún claim como aprobado.
- **AC 5.22**: **regla de bloqueo de D17, con el LLM mockeado.**
  - Un claim `UNSUPPORTED` con `specificity` `CONCRETE` bloquea: el borrador no pasa a `OFFICIAL` y la falla llega al feedback de la enmienda.
  - Un claim `UNSUPPORTED` con `specificity` `GENERAL` no bloquea: el borrador pasa a `OFFICIAL` si no hay otras fallas, su `FactCheck` queda persistido con `UNSUPPORTED` y no suma a `errorsDetected`.
  - `FALSE` y `MISLEADING` bloquean en los dos casos.
  - `CONTESTED` no bloquea.
  - Un claim con un dígito en el `statement` queda `CONCRETE` aunque la extracción lo haya clasificado `GENERAL`.
  - Se verifica con tests del orquestador y de `FactCheckService`.
- **AC 5.23**: **clasificación con modelos reales, en el conjunto de referencia (AC 5.12).**
  - Las cifras inventadas de MyAnimeList de #17 (ratings que ninguna fuente respalda) se clasifican como dato concreto, salen `UNSUPPORTED` (o `FALSE`) y **bloquean** el argumento.
  - Ningún claim etiquetado a mano como dato concreto se clasifica como afirmación general (0 errores en esa dirección, por la asimetría de D17).
  - Los claims generales clasificados como dato concreto se cuentan y se registran en `decision-log.md`, sin umbral.
- **AC 5.25**: **lote inválido** (D19). Una llamada de verificación cuyo lote sigue inválido después de los reintentos produce estos efectos:
  - el episodio queda en `REQUIRES_HUMAN_REVIEW` con motivo `PROVIDER_QUOTA_EXCEEDED`;
  - `llmCalls` no cambia respecto de antes de esa llamada, y la `revision` del argumento tampoco (no se consumió ninguna enmienda);
  - el `DRAFT` sigue en `DRAFT`.

  Al reanudar, ese mismo `DRAFT` se retoma según D15, sin `argue`/`respond`. Se verifica con tests del orquestador con un lote mockeado que nunca cubre todos los claims.

### Modelos y texto

- **AC 5.14**: ninguna llamada LLM del pipeline (generación, extracción, verificación, revisión editorial, veredicto ni research) usa `liquid/lfm-2.5-2.6b:free`, y `OPENROUTER` solo resuelve a `nvidia/nemotron-3-super-120b-a12b:free` (D12). Ninguna llamada de verificación (extracción, hechos, editorial) usa `OPENROUTER` (D6). Se verifica con un test sobre la resolución de modelos de `OPENROUTER`, con tests del orquestador que comprueban el proveedor de las 3 llamadas de verificación con un debatiente en `OPENROUTER`, y con las filas de `EpisodeLlmCall` de los smoke tests de AC 5.6.
- **AC 5.15**: ningún argumento `OFFICIAL` contiene un UUID (D13).
  - Con el LLM mockeado, un borrador con un UUID no llega a la extracción: no se hace ninguna llamada de verificación en esa vuelta, el debatiente recibe una enmienda con una falla de formato, se consume una enmienda (`revision` + 1) y `fact_check.completed` sale con `FAILED` y `errorsDetected: 1`.
  - El texto de la evidencia que recibe el debatiente no contiene `sourceId` (test sobre el prompt de `argue`/`respond`/`amend`).
  - Sobre los argumentos de los smoke tests, una búsqueda por expresión regular da 0 UUIDs.
- **AC 5.16**: en los smoke tests de AC 5.6 se cuentan, por proveedor y modelo, los argumentos `OFFICIAL` con metatexto dirigido al sistema (saludos, "he analizado la evidencia") y los que terminan cortados a mitad de palabra u oración. El resultado se registra en `decision-log.md` (D14). No hay umbral: la medición alimenta la decisión de D14.
- **AC 5.24**: **largo objetivo** (D18).
  - Con el LLM mockeado, el prompt de `argue`, `respond`, `amend` y `regenerate` incluye la instrucción de largo de 800-1200 caracteres para `ES`, `EN` y `PT`, y sigue incluyendo la instrucción de idioma en los mismos lugares que exige AC 4.6.
  - En los smoke tests de AC 5.6, la mayoría (más del 50 %) de los argumentos `OFFICIAL` mide entre 800 y 1200 caracteres, y ninguno pasa de 2000.
  - La distribución de largos, por proveedor y modelo, queda en `decision-log.md`.

### Recuperación

- **AC 5.17**: si un episodio frena en `DEBATING` con un `DRAFT` en curso y se reanuda, no se hace ninguna llamada `argue`/`respond` para ese agente en esa ronda: se continúa con el contenido vigente del `DRAFT` más reciente. El freno puede ser por `USAGE_LIMIT_EXCEEDED` o por `PROVIDER_QUOTA_EXCEEDED`, incluido el de D19. Al terminar la ronda, ese agente tiene un solo argumento nuevo en ella, sin `DRAFT` huérfanos creados después de esta spec. Lo mismo vale para la recuperación después de un reinicio (`EpisodeRecoveryService`). Se verifica con tests del orquestador y de la recuperación.
- **AC 5.18**: las enmiendas hechas antes de la reanudación o de la recuperación cuentan para `maxRevisionAttempts` (D16). Con `maxRevisionAttempts = 3`, un borrador que ya tenía 2 enmiendas antes del corte admite 1 sola más, tanto si se reanuda con `resume` (aunque el curador haya subido el presupuesto) como si lo retoma `EpisodeRecoveryService`. Si la verificación de esa versión sigue con fallas, el episodio pasa a `MAX_REVISIONS_EXCEEDED`, sin otras 3 enmiendas. Se verifica con tests de los dos caminos.
- **AC 5.19**: después de `MAX_REVISIONS_EXCEEDED`, reanudar genera un borrador nuevo para ese agente, como hoy. El argumento rechazado queda `REJECTED`.
- **AC 5.26**: **vuelta a medio verificar** (D15). Al retomar un `DRAFT` cuya versión vigente ya tiene claims extraídos, no se vuelve a extraer. Solo se verifican los claims `FACTUAL` de esa versión que todavía no tienen `FactCheck`, y la revisión editorial se rehace. Casos que cubre el test:
  - corte después de la extracción: se hacen las 2 llamadas restantes;
  - corte después de verificar los hechos: se hace solo la editorial;
  - corte durante el `amend`: se hace solo la editorial de la versión vigente, sin re-extraer.

  Se verifica con tests del orquestador que cuentan las llamadas por caso.

### Contratos e idioma

- **AC 5.20**: `pnpm openapi:generate && git diff --exit-code openapi.json` da 0: no cambian `CheckpointReason`, `usage`, `limits` ni los DTOs de eventos SSE (D2). `fact_check.completed` se sigue emitiendo una vez por vuelta completada, con `status` `PASSED`/`FAILED` y `errorsDetected` igual a la cantidad de fallas que bloquean en esa vuelta, incluida la falla de formato de D13. Se verifica con tests.
- **AC 5.21**: toda llamada evaluadora nueva o modificada, y la enmienda con varias fallas, llevan la instrucción de idioma y escriben sus campos libres en el idioma del episodio, igual que AC 4.6 y 4.7. Se verifica con tests del prompt para `ES`, `EN` y `PT`.

## Edge cases

- **Borrador sin claims, o solo con claims de un tipo**: no se hace la llamada del tipo que falta (AC 5.1). Un borrador sin ningún claim pasa, como hoy, con el costo de la extracción.
- **Lote de verificación inválido** (D19, AC 5.25): se reintenta dentro de la misma llamada contada, sin consumir enmienda. Si los reintentos se agotan, el episodio frena con `PROVIDER_QUOTA_EXCEEDED`, y al reanudar el `DRAFT` se retoma con su conteo (D15, D16).
- **El lote inválido se repite después de reanudar**: por la regla de repetición de causa (spec 003, AC 3.52), si tras reanudar vuelve a ocurrir `PROVIDER_QUOTA_EXCEEDED` antes de un motivo distinto, el episodio pasa a `FAILED`. El panel no distingue un lote inválido de una cuota agotada (ver "Dependencias", spec 003), pero la causa queda auditada en el log (`VerificationUnavailableError` con su `cause`) y en `EpisodeLlmCall` (`succeeded = false` en la operación de verificación; ADR 0003, Consecuencias).
- **Una cuota real de `GOOGLE` agotada durante la verificación**: es el mismo motivo, `PROVIDER_QUOTA_EXCEEDED`, como hoy. Ahora frena cualquier verificación, sea cual sea el proveedor del debatiente (ver "Riesgos").
- **Borrador al tope de 2000 caracteres con más de 25 claims**: la cota de AC 5.1 vale hasta el tamaño máximo de un borrador; el lote se manda entero. Con D18, este caso debería ser raro.
- **Borrador con un UUID** (D13): la vuelta termina antes de extraer, sin llamadas de verificación, y se enmienda con una falla de formato que consume una enmienda (AC 5.15).
- **La enmienda corrige una falla e introduce otra**: la falla nueva se verifica en la vuelta siguiente (D8) y consume un intento.
- **La enmienda que atiende muchas fallas pasa de 2000 caracteres**: hoy la rechaza el schema. Las fallas juntas (D7) hacen este caso más probable; el largo objetivo de D18 deja margen. Se observa en los smoke tests.
- **Argumento fuera del rango de 800-1200 caracteres**: no se rechaza ni se enmienda; solo cuenta en la medición de AC 5.24 (D18). Un argumento más corto, con pocos claims, también es válido.
- **Un claim que falló vuelve idéntico en la versión enmendada**: se verifica de nuevo (D8). Si el falso negativo se repite, puede llegar a `MAX_REVISIONS_EXCEEDED`; el curador lo resuelve con "Reanudar", que genera un borrador nuevo.
- **Un claim casi igual a uno ya aprobado** (por ejemplo, "78 %" cambiado a "87 %"): se vuelve a verificar, porque la reutilización exige igualdad exacta del `statement` normalizado (D8).
- **Un claim mezcla un dato concreto con una interpretación y D9 no logra separarlos**: si el claim `FACTUAL` contiene al menos un elemento de la definición de D17, es dato concreto, y un `UNSUPPORTED` bloquea.
- **Un dato concreto cierto, pero que el research no cubrió**: sale `UNSUPPORTED` y bloquea. Es el costo que ya aceptó #17 para las cifras sin respaldo, y D17 lo mantiene para los datos concretos. El debatiente puede quitarlo o reformularlo en lo cualitativo (`decision-log.md` #18).
- **Una afirmación general falsa**: si el verificador la marca `FALSE` o `MISLEADING`, bloquea igual (D17). D17 solo cambia el tratamiento de `UNSUPPORTED`.
- **El respaldo existe en la fuente pero no en el `EvidenceFact`**: el verificador no lo ve y el claim queda `UNSUPPORTED` o `FALSE`. **No** fue la causa del caso del Estadio Obras (P8, resuelta: el respaldo estaba en el `EvidenceFact`), pero el caso puede darse. Resolverlo requiere cambiar qué evidencia ve el verificador, cambia el alcance y queda fuera de esta spec.
- **Presupuesto agotado a mitad de una vuelta**: como las 3 llamadas van en serie, las que no llegaron a hacerse no aprueban nada (AC 5.13) y no queda ninguna escritura posterior al checkpoint. Al reanudar se retoma ese mismo `DRAFT` (AC 5.17), sin re-extraer si la versión ya tenía claims (AC 5.26), con el conteo de enmiendas conservado (D16).
- **Reanudación o recuperación con un `DRAFT` a medio verificar**: entra en el MVP (D15, AC 5.26). No se re-extrae; solo se verifica lo que falta y se rehace la editorial.
- **Varios `DRAFT` del mismo agente en la ronda** (por ejemplo, los huérfanos que dejó el comportamiento anterior, como `29a24266`): se retoma el más reciente. Los anteriores quedan como estaban.
- **Argumentos anteriores a esta spec**: `Argument.revision` y `Claim.revision` se completan con backfill (ADR 0003, punto 7). AC 5.10 se verifica sobre argumentos promovidos después de implementar la spec.
- **El proveedor no informa tokens**: la llamada cuenta en `llmCalls`, su fila de `EpisodeLlmCall` queda sin tokens y el episodio no falla (AC 5.8).
- **Episodios en curso al desplegar**: conservan su `maxLlmCalls` (AC 5.7) y, al reanudarse, siguen las reglas nuevas.
- **OpenRouter con un solo modelo** (D12): la cuenta comparte 50 pedidos diarios (`OPENROUTER_RPD_LIMIT`, `decision-log.md` #13). Como ya no verifica (D6), solo lo consumen las generaciones. Si `nemotron` está limitado del lado del proveedor del modelo, ya no hay un segundo modelo de respaldo.
- **Episodio en `EN`/`PT`**: las reglas editoriales siguen en español (spec 004, D11). La revisión editorial en lote tiene que conservar la aclaración de que el idioma no es por sí solo una violación (`fact-check.service.ts:99-101`). El rango de largo de D18 es el mismo en los tres idiomas.
- **`regenerate` del curador**: consume 1 llamada, no pasa por el verificador (spec 003, AC 3.45) y recibe la instrucción de largo (D18).

## MVP vs. nice-to-have

**MVP** (la spec se cumple con esto):

- Verificación en 3 llamadas como máximo, en serie, con `GOOGLE` como verificador fijo e independiente de la cantidad de claims (D6, AC 5.1, 5.2).
- Una sola enmienda con todas las fallas (D7, AC 5.3).
- Sin re-verificar lo que ya pasó, y sin duplicados (D8, D9, AC 5.4, 5.5).
- Extractor que separa hecho de interpretación (D9, AC 5.11).
- `UNSUPPORTED` bloquea solo los datos concretos, con clasificación trazable (D17, AC 5.22, 5.23).
- Condición previa del fact-check y trazabilidad intactas (D1, D5, AC 5.9, 5.10, 5.13).
- Lote inválido reanudable, sin castigar al debatiente (D19, AC 5.25).
- Conjunto de referencia sin regresiones, con línea de base del verificador nuevo (AC 5.12).
- Fuera el modelo de 2,6B de todo el pipeline (D12, AC 5.14).
- Sin UUIDs en los argumentos `OFFICIAL`, con chequeo determinístico (D13, AC 5.15), y medición de metatexto y cortes (D14, AC 5.16).
- Largo objetivo de 800-1200 caracteres como instrucción, medido (D18, AC 5.24).
- Continuar el `DRAFT` al reanudar o recuperar, incluida la vuelta a medio verificar, conservando el conteo de enmiendas (D15, D16, AC 5.17-5.19, 5.26).
- Tokens en `EpisodeUsage` y una fila por llamada en `EpisodeLlmCall`, sin exponerlos (D10, AC 5.8).
- `maxLlmCalls` por defecto calibrado después de medir (D11, AC 5.6, 5.7).
- Contratos e idioma sin cambios (D2, D3, AC 5.20, 5.21).

**Nice-to-have** (no se implementa sin pedirlo):

- Exponer los tokens o el modelo por llamada en `usage`, `openapi.json` y el dashboard (cambio de contrato de la spec 003, AC 3.30).
- Mostrar las llamadas por argumento o las vueltas de enmienda en el detalle del episodio.
- Persistir el resultado de la revisión editorial para auditoría. Hoy no se guarda: `decision-log.md` #11 tuvo que deducir el motivo de los rechazos.
- Validar metatexto y cortes y mandarlos al loop de enmienda (D14), si la medición lo justifica.
- Tope duro de claims por borrador. **Se desaconseja**: deja claims sin verificar (D1), y con D6 ya no ahorra llamadas.
- Un modelo de reemplazo validado para OpenRouter (D12), con su script de validación.

## Restricciones técnicas (de la revisión de `architect`)

El diseño aprobado está en los ADR 0003 y 0004. Lo que esta spec da por sentado:

- **Algoritmo de verificación.** `architecture.md` §7 dice "Paralelización solo en el fact-checking de claims", y §7.3 describe un `Promise.all` de una llamada por claim. El ADR 0003 reemplaza los dos con 3 llamadas en serie y verificador fijo. `architecture.md` lo actualiza `architect` aparte.
- **Schemas de salida planos, sin `.refine()`.** Los lotes usan schemas planos:
  - hechos: `{claimRef, veracity, analysis, evidenceRefs}`;
  - editorial: `{claimRef, passed, violatedRule|null, reason|null}`.

  El `.refine()` de `EditorialReviewOutputSchema`, que falló en OpenRouter (#14), desaparece y no se agrega ninguno nuevo. Los prompts numeran claims y hechos con `C1..Cn` y `E1..Em`, y el backend traduce las referencias.
- **Contrato interno de enmienda.** `AmendmentFeedbackSchema` (`agents.contracts.ts:98-102`) pasa a `AmendmentFeedback.failures[]`, con un motivo nuevo, `FORMAT_VIOLATION`, para D13. Es un contrato interno entre el orquestador y los agentes, no del dashboard (D2).
- **Claims versionados.** Se agregan `Argument.revision` y `Claim.revision` (los dos con backfill), `Claim.specificity` (enum nuevo, nullable) y `FactCheck.reusedFromId`. "Claims de la versión final" = `Claim.revision == Argument.revision`.
- **`FactCheckVeracity` y `Claim` no están en `openapi.json`.** D17 no agrega un valor a `FactCheckVeracity` por una razón **semántica**, no de contrato: la veracidad describe la relación del claim con la evidencia, y la especificidad es una propiedad del claim, por eso va en `Claim.specificity`.
- **Registro por llamada.** Va en la tabla nueva `EpisodeLlmCall` (ADR 0004). `LlmRequestLog` no cambia.

## Orden sugerido de validación

Es el orden en que conviene medir para no decidir a ciegas. No es un plan de implementación (lo arma `roadmap-planner`):

1. ~~Diagnosticar el caso del Estadio Obras en `dev.db`~~ (hecho el 2026-10-01, P8 resuelta: el respaldo estaba en el `EvidenceFact`; el modelo concreto no quedó registrado).
2. Armar el conjunto de referencia, con las etiquetas de D17, y medir la línea de base actual y la del verificador nuevo (`gemini-3.5-flash-lite`, y también `nemotron` como comparación) (AC 5.12). Si `GOOGLE` falla el caso del Estadio Obras, decide el usuario antes de seguir.
3. Implementar el MVP.
4. Correr el conjunto de referencia y los smoke tests (AC 5.6, 5.12, 5.15, 5.16, 5.23, 5.24).
5. Con los números reales, fijar el `maxLlmCalls` por defecto (D11, AC 5.7), revisar D14 y decidir si hace falta el respaldo de fusionar los hechos y la editorial (D6).

## Dependencias con otras specs, features y docs

- **ADR 0003** (`docs/adr/0003-verificacion-en-lote-proveedor-fijo.md`, propuesto): verificación en lote, verificador fijo `GOOGLE`, referencias cortas, schemas planos, claims versionados, reutilización, lote inválido e idempotencia por versión. Amplía `decision-log.md` #14: de "solo `editorialReview` va a `GOOGLE`" a "toda la verificación va a `GOOGLE`".
- **ADR 0004** (`docs/adr/0004-registro-por-llamada-llm.md`, propuesto): `EpisodeLlmCall` y el registro de tokens.
- **Spec 003** (`003-dashboard-ui.md`): **sin cambios de contrato** (D2, AC 5.20). Siguen valiendo AC 3.30 (barras de uso), AC 3.45 y 3.46 (`regenerate`, sin fact-check), AC 3.51 (6 motivos) y AC 3.52. Efecto visible esperado sin tocar la UI: menos `USAGE_LIMIT_EXCEEDED` y menos `MAX_REVISIONS_EXCEEDED`, y argumentos regenerados más cortos (D18).
  - **Ajuste opcional**: el texto del panel `PROVIDER_QUOTA_EXCEEDED` (AC 3.51) habla de "cuota". Para un lote inválido (D19) es aproximado. Se puede ajustar con el mismo criterio que se elija para API-21.
  - Si se decide exponer tokens (nice-to-have), eso se integra en la 003 (AC 3.30) por separado. API-20 (`executionTime`) sigue pendiente aparte.
- **Spec 004** (`004-debate-language.md`): D3 y AC 5.21 extienden AC 4.6 y 4.7 a las llamadas nuevas. La instrucción de largo de D18 convive con la instrucción de idioma de AC 4.6 sin reemplazarla (AC 5.24). El texto de respaldo `editorialViolationFallback` sigue aplicando a la editorial en lote y a la enmienda con varias fallas.
- **Spec 001**: AC 5.20 usa su criterio de `openapi.json` idempotente.
- **`features.md`** (congelado): Feature 2 (default de 25 llamadas y registro de tokens), Feature 3 (el loop de enmienda habla de "un claim"; enviar todas las fallas es compatible con su propósito) y Feature 10 (trazabilidad). No se editan; las extensiones se documentan en `decision-log.md`.
- **`architecture.md`** (actualizado por `architect` el 2026-10-01, con cada cambio marcado como propuesto hasta que se implementen los ADR 0003/0004):
  - §5.2 y §7.1: la nota sobre los modelos de OpenRouter, que queda desactualizada con D12 y D6;
  - §6: columnas nuevas `Argument.revision`, `Claim.revision` y `Claim.specificity`, y la tabla `EpisodeLlmCall`;
  - §7: la viñeta de paralelización;
  - §7.3: el algoritmo de verificación.
- **`decision-log.md`**:
  - #11: presupuesto ajustado; la causa no se había atacado.
  - #12: contexto editorial y UUIDs en el texto.
  - #13: OpenRouter y sus dos modelos; D12 deja uno solo.
  - #14: `editorialReview` forzado a `GOOGLE`; el ADR 0003 lo amplía a toda la verificación.
  - #15: presupuesto atómico con llamadas en paralelo. Con las llamadas en serie el caso desaparece en la verificación, pero la garantía se mantiene.
  - #17: `UNSUPPORTED` como falla. D17 adopta su opción 3, antes descartada, y eso se registra como entrada nueva.
  - #18: instrucción anti-alucinación.
- **`tasks.md` §12**: API-20, solo como referencia. **API-21** se decide con el mismo criterio que D19 (fallo final del proveedor → `PROVIDER_QUOTA_EXCEEDED`, reanudable). D19 ya lo aplica a las 3 llamadas de verificación; el resto de las llamadas sigue en API-21.

## Preguntas abiertas

No quedan preguntas abiertas propias de esta spec. Las decisiones del usuario y las de `architect` se resolvieron el 2026-10-01 (ver abajo). La aceptación de los ADR 0003 y 0004, que están propuestos, la da el usuario.

### Resueltas

**P1. Criterio de `UNSUPPORTED`: resuelta (2026-10-01, decisión del usuario, opción b) → D17.** `UNSUPPORTED` bloquea solo los datos concretos (cifras, fechas, nombres, hechos verificables puntuales), definidos de forma testeable en D17. Las afirmaciones generales o interpretativas sin respaldo no bloquean. D9 se mantiene igual. El caso de MyAnimeList de #17 sigue bloqueando (AC 5.23). Aclaración sobre la versión anterior de esta pregunta, que decía "(b) no resuelve el caso del Estadio Obras": ese caso fue un `FALSE` por mal razonamiento, no un `UNSUPPORTED`. Lo cubren el verificador fijo y AC 5.12, no el criterio. Opciones descartadas: (a) dejar la regla como estaba y confiar solo en D9; (c) bloquear solo `FALSE`/`MISLEADING`, que reabría las cifras inventadas de #17.

**P2. Granularidad de la verificación: resuelta (2026-10-01, `architect`, ADR 0003, punto 1) → D6.**
- **Decisión.** 3 llamadas por versión (extracción, hechos en lote y editorial en lote), en serie y sin pasos fusionados. Si no hay claims de un tipo, la llamada que corresponde se omite.
- **Respaldo.** Fusionar los hechos y la editorial queda como respaldo, solo si AC 5.6 no llega a 6 llamadas o menos por argumento.
- **Descartadas:**
  - fusionar la extracción con la verificación, porque imposibilita AC 5.4 y mezcla la clasificación de D17 con la evidencia;
  - una sola llamada para todo.
- **Consecuencia.** Con 3 llamadas, un episodio por defecto sin enmiendas cuesta unas 26 llamadas: por eso hace falta recalibrar el default (D11).

**P3. Valor por defecto de `maxLlmCalls`: resuelta (2026-10-01, decisión del usuario) → D11 tal como estaba.** Se recalibra después de medir con AC 5.6. Las referencias de unas 40 llamadas (3 de verificación más 3 vueltas de margen: 26 + 3 × 4 = 38) y unas 30 (verificación fusionada: 20 + 3 × 3 = 29) quedan solo como orientación.

**P4. ¿Quién verifica?: resuelta (2026-10-01, decisión del usuario; ADR 0003, punto 2) → D6.** `GOOGLE` es el verificador fijo de las 3 llamadas, incluida la extracción, sea cual sea el proveedor del debatiente. Argumento que pesó, del diagnóstico de P8: el falso negativo del Estadio Obras fue un error de razonamiento del modelo que verificó (`OPENROUTER`), con la evidencia literal a la vista, y la calidad del control no puede depender del sorteo. Costo aceptado: `GOOGLE` pasa a ser el punto único de falla de la verificación (ver "Riesgos"). Descartada: verificar con el proveedor del debatiente.

**P5. Alcance de sacar el modelo de 2,6B: resuelta (2026-10-01, decisión del usuario) → D12.** `liquid/lfm-2.5-2.6b:free` sale de todo el pipeline, no solo de la generación de los debatientes. `OPENROUTER` queda solo con `nvidia/nemotron-3-super-120b-a12b:free` y, con P4, ya no participa de la verificación. Argumento que pesó, del diagnóstico de P8: el `check` que falló en el caso del Estadio Obras lo hizo `OPENROUTER`. Probablemente fue el modelo de 2,6B, aunque no se puede confirmar porque el modelo sorteado no se registraba (de ahí D10).

**P6. Conteo de enmiendas al reanudar: resuelta (2026-10-01, decisión del usuario) → D16.** El conteo se conserva al reanudar (también después de subir el presupuesto) y al recuperar después de un reinicio (AC 5.18). Se descartó reiniciar los intentos en una reanudación explícita del curador.

**P7. Largo objetivo de un argumento: resuelta (2026-10-01, decisión del usuario) → D18.** Sí hay un largo objetivo: unos 800-1200 caracteres por argumento, como instrucción en el prompt, con el tope de 2000 del schema como límite duro. Se mide en los smoke tests (AC 5.24) y la instrucción de idioma de la spec 004 se mantiene.

**P8. Causa del falso negativo del Estadio Obras: resuelta (2026-10-01, consulta a `dev.db` de la sesión principal).**
- **Evidencia.** La fuente `508b2eb7` (consequence.net) del tópico `f748c653…` tiene tres `EvidenceFact`:
  - uno dice literalmente que el show en el Estadio Huracán del 8 de septiembre de 2027 "representa la primera vez que la banda se presenta en un estadio de fútbol en Argentina";
  - otro menciona "un par de shows en el Estadio Obras en 2005" y Knotfest 2024;
  - el tercero trata sobre la etapa latinoamericana.
- **Conclusión.** El respaldo estaba en el `EvidenceFact`, no solo en el `snippet`. El verificador tenía la evidencia literal y razonó mal. No hace falta cambiar qué evidencia ve el verificador, y AC 5.12 exige que el claim pase.
- **Quién verificó.** El `check` lo hizo el proveedor del Analyst (`OPENROUTER`). El modelo concreto no se registra (`LlmRequestLog` solo guarda el proveedor y la fecha), así que es probable, pero no está confirmado, que fuera el de 2,6B.

**P9. Verificación en lote con una respuesta inválida: resuelta (2026-10-01, `architect`, ADR 0003, puntos 5 y 6) → D19.**
- **Decisión.** El lote inválido se reintenta dentro de la misma llamada contada.
- **Qué es un lote válido.** Cada `claimRef` pendiente aparece exactamente una vez. Las referencias inexistentes se descartan, y si un resultado factual queda sin evidencia, el lote es inválido.
- **Si se agotan los reintentos.** Sale `VerificationUnavailableError` y el episodio pasa a `PROVIDER_QUOTA_EXCEEDED`. No consume enmienda, la llamada devuelve el cupo y el `DRAFT` se retoma.
- **Descartadas:** contarlo como enmienda, `VALIDATION_INCONSISTENCY` y un motivo nuevo (rompe D2).
- **Relación con API-21.** API-21 se decide con el mismo criterio.

## Riesgos

- **`GOOGLE` como punto único de falla de la verificación** (D6). Con 500 pedidos diarios y unas 20-35 llamadas de verificación por episodio, más research, juez y debatientes en `GOOGLE`, entran unos 12-15 episodios por día. Si se agota la cuota, toda verificación frena con `PROVIDER_QUOTA_EXCEEDED`, sea cual sea el proveedor del debatiente.
- **`gemini-3.5-flash-lite` no está probado con el caso del Estadio Obras.** La línea de base de AC 5.12 se corre con ese modelo, y conviene medir también `nemotron`. Si `GOOGLE` falla ese caso, decide el usuario: el verificador fijo no alcanza por sí solo para ese caso.
- **Calidad de la verificación en lote**: un modelo que verifica 20 claims juntos puede prestar menos atención a cada uno que con 20 llamadas separadas. Lo mitiga AC 5.12 (línea de base y 0 regresiones).
- **Clasificación de dato concreto** (D17): si se clasifica como general un dato concreto inventado, pasa sin respaldo. Lo mitigan la definición testeable, la red determinística de los dígitos y el criterio de 0 errores en esa dirección (AC 5.23). Clasificar de más solo cuesta enmiendas.
- **Lotes inválidos**: los schemas planos y las referencias cortas bajan el riesgo de #14 (desaparece el `.refine()`), pero un lote al que le falta un claim se reintenta entero, con más tokens. Si se agotan los reintentos, el episodio frena con un motivo cuyo texto habla de "cuota" (ver "Dependencias", spec 003).
- **Tokens**: menos llamadas no garantiza menos tokens. D10 y AC 5.8 permiten verlo; no hay un límite de tokens en esta spec.
- **Menos diversidad de modelos** (D12): `OPENROUTER` queda con un solo modelo `:free`, expuesto a límites del proveedor del modelo.
- **El largo objetivo es solo una instrucción** (D18): los modelos pueden ignorarla. AC 5.24 lo mide; validar el largo queda fuera de alcance.
- **No determinismo**: 3 smoke tests no son evidencia estadística (salvedad ya hecha en #18). Los números de AC 5.6 y 5.24 son un piso de verificación, no una garantía.
- **Default calibrado sobre pocas corridas** (D11): un tópico con mucha evidencia contradictoria puede seguir agotando el presupuesto. El curador conserva "Reanudar" con límites más altos (AC 3.51).

## Bitácora

- **2026-10-01**: primera versión, escrita por `product-analyst` a partir del caso real `7d2cee7d-1d16-427b-bf98-b285eb3e88a5` y del análisis de costo de la sesión principal (verificado sobre `dev.db` y el código). Se revisó contra `episode-orchestrator.service.ts` (`processDraft`, `runRound`, `isFactCheckFailure`), `fact-check.service.ts`, `model-provider.factory.ts`, `agents.contracts.ts`, `schema.prisma`, `episode-detail.mapper.ts`, `features.md` (Features 2, 3 y 10), `architecture.md` §7, `decision-log.md` #11-#18 y la spec 003 (AC 3.30, 3.45, 3.51). Hallazgos propios de esta pasada:
  - `extractClaims` y `check` corren con el proveedor del debatiente, así que el modelo de 2,6B también verifica (D12, P5).
  - `features.md` Feature 2 ya exige registrar tokens (D10).
  - El borrador huérfano viene de que `runRound` solo saltea a los agentes que ya tienen un argumento `OFFICIAL` (D15).
  - Aun verificando en lote con 3 llamadas, un episodio por defecto sin enmiendas cuesta 26 llamadas, más que 25 (P2, P3).
  - El verificador no ve los `snippet` de las fuentes, lo que podía explicar el caso del Estadio Obras (P8; descartado en la entrada siguiente).
  - Un tope duro de claims violaría la condición previa del fact-check (D9).
- **2026-10-01, P8 resuelta** (diagnóstico de la sesión principal sobre `dev.db`): el respaldo del claim del Estadio Obras estaba literal en un `EvidenceFact` de la fuente `508b2eb7`; el verificador (`OPENROUTER`, modelo no registrado) razonó mal. Cambios: AC 5.12 deja de estar condicionado; D10, AC 5.8, el MVP y US 5.6 suman el registro del modelo concreto por llamada; P4 y P5 suman el argumento del razonamiento defectuoso.
- **2026-10-01, decisiones del usuario sobre P1, P3, P5, P6 y P7** (integradas por `product-analyst`):
  - **P1 → D17 nueva**, con AC 5.22 y 5.23.
  - **P3 → D11**, sin cambios de fondo.
  - **P5 → D12**.
  - **P6 → D16**, que ahora cubre también la recuperación.
  - **P7 → D18 nueva**, con AC 5.24.
- **2026-10-01, revisión de `architect`: aprobada con cambios, aplicados.** Origen de los ADR 0003 y 0004 (propuestos). El usuario confirmó P4: `GOOGLE` es el verificador fijo de las 3 llamadas.
  - **Preguntas que pasan a resueltas:**
    - P2: 3 llamadas en serie, sin pasos fusionados; fusionar hechos y editorial queda como respaldo.
    - P4: verificador fijo `GOOGLE`; se quitó del nice-to-have.
    - P9: D19 nueva, lote inválido → `PROVIDER_QUOTA_EXCEEDED` reanudable, con AC 5.25 nuevo.
  - **Cambios en las decisiones:**
    - D6: en serie, verificador fijo y referencias `C1..Cn`/`E1..Em`.
    - D12: `OPENROUTER` fuera de la verificación.
    - D13: chequeo determinístico de UUID con falla de formato que consume una enmienda, y `formatEvidence` sin `sourceId`.
    - D15: la vuelta a medio verificar pasa al MVP, con AC 5.26 nuevo; se quitó del nice-to-have.
    - D10: tabla `EpisodeLlmCall`, y los tokens suman todos los intentos.
    - D11: nota sobre el `@default` en SQLite.
  - **Cambios en los AC:**
    - AC 5.9: suma el caso de una `evidenceRef` inexistente.
    - AC 5.10: solo argumentos promovidos por el pipeline.
    - AC 5.14 y 5.15: el mecanismo nuevo.
    - Ajustes en AC 5.1, 5.4, 5.6, 5.7, 5.8, 5.12, 5.13, 5.17, 5.20 y 5.22.
  - **Correcciones de hecho:**
    - `FactCheckVeracity` y `Claim` no están en `openapi.json`: la razón para no tocar el enum es semántica.
    - Los schemas de lote son planos y desaparece el `.refine()` de #14: se corrigió el riesgo de "schema más complejo".
  - **Otros:** se reescribieron "Restricciones técnicas", "Dependencias" (ADR, API-21 con el mismo criterio que P9, ajuste opcional del panel de la 003, secciones de `architecture.md` a actualizar aparte), los edge cases y "Riesgos" (`GOOGLE` como punto único de falla, `gemini-3.5-flash-lite` sin probar con el caso del Estadio Obras).
