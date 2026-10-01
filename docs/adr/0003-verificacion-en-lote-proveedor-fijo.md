# 0003: Verificación de borradores en lote, con proveedor fijo y claims versionados

Estado: **propuesto** (2026-10-01). Origen: spec `docs/product/005-verification-cost.md` (D6-D9, D15-D17, P2, P4, P9). Lo propone `architect` en su revisión de la spec 005; falta la aceptación del usuario. Amplía `decision-log.md` #14 (de "solo `editorialReview` va a `GOOGLE`" a "toda la verificación va a `GOOGLE`") y reemplaza `architecture.md` §7.3 y la viñeta "Paralelización solo en el fact-checking de claims" de §7.

## Contexto

- `processDraft` (`apps/api/src/modules/episodes/episode-orchestrator.service.ts:320-417`) hace 1 extracción y 1 llamada por claim en un `Promise.all`, y repite todo en cada enmienda. Con ~10 claims por borrador, un argumento cuesta ~12 llamadas (spec 005, "El problema").
- `extractClaims` y `check` corren con el proveedor del debatiente; `editorialReview`, con `GOOGLE` (`EDITORIAL_REVIEW_PROVIDER`, #14). El único schema con `.refine()` (`EditorialReviewOutputSchema`) es el que falló en OpenRouter.
- El conteo de enmiendas vive solo en memoria (`let attempts = 0`), y `runRound` (`:428-438`) solo saltea agentes con un argumento `OFFICIAL`: al reanudar se genera un borrador nuevo y el conteo vuelve a 0.
- `Claim` no tiene versión: los claims de todas las vueltas se acumulan en el mismo `Argument`, y `extractClaims` los crea con un `Promise.all` de `create` sueltos (no atómico).
- `FactCheck` exige al menos una `Source` (AC 1.2). Hoy un `sourceId` alucinado llega a `connect` y tira un error de Prisma que cae en "error no clasificado".
- La Evidence Base de un episodio es la del tópico y no cambia durante `DEBATING` (`runResearchPhase` solo investiga si no hay `EvidenceFact`).
- Límites: `GOOGLE` (`gemini-3.5-flash-lite`) 15 RPM / 500 RPD; `OPENROUTER` 20 RPM / 50 RPD por cuenta (`env.schema.ts:47-55`).

## Decisión

1. **Tres llamadas por versión, en serie** (P2). Cada versión de un borrador se verifica con, como máximo:
   1. `extractClaims`: segmenta, clasifica el tipo y, para los `FACTUAL`, la especificidad (D17);
   2. `verifyFacts`: un lote con los claims `FACTUAL` pendientes (D8), contra la Evidence Base enviada **una sola vez**;
   3. `reviewEditorial`: un lote con todos los claims no factuales de la versión, con el argumento completo (#12).

   La llamada 2 o la 3 no se hace si no tiene claims. Las tres corren **en serie** (sin `Promise.all`): si una frena por presupuesto o por el proveedor, la siguiente no arranca y no queda ninguna escritura posterior al checkpoint. No se fusionan pasos en el MVP (ver Alternativas).
2. **Verificador fijo** (P4). Las tres llamadas usan `VERIFICATION_PROVIDER = "GOOGLE"`, una constante de `EpisodesModule` que reemplaza a `EDITORIAL_REVIEW_PROVIDER`. `FactCheckService` sigue recibiendo el proveedor por parámetro y no sabe cuál es.
3. **Referencias cortas, no UUIDs, en los prompts de verificación.** El backend numera los claims (`C1..Cn`) y los `EvidenceFact` (`E1..Em`) en el prompt, y traduce las referencias al guardar. El modelo nunca copia un UUID.
4. **Schemas de salida planos, sin `.refine()`** (`shared/contracts/agents.contracts.ts`):

   ```ts
   export const ClaimSpecificity = z.enum(["CONCRETE", "GENERAL"]);

   export const ExtractedClaimSchema = z.object({
     statement: z.string().min(1),
     type: ClaimType,
     specificity: ClaimSpecificity, // obligatorio en todos; se ignora si type !== FACTUAL
   });

   export const FactCheckBatchOutputSchema = z.object({
     results: z.array(
       z.object({
         claimRef: z.string().min(1), // "C3"
         veracity: FactCheckVeracity,
         analysis: z.string().min(1),
         evidenceRefs: z.array(z.string().min(1)).min(1), // ["E2", "E7"]
       })
     ),
   });

   export const EditorialBatchOutputSchema = z.object({
     results: z.array(
       z.object({
         claimRef: z.string().min(1),
         passed: z.boolean(),
         violatedRule: z.string().nullable(), // null si passed
         reason: z.string().nullable(),
       })
     ),
   });

   export const AmendmentFailureSchema = z.object({
     reason: z.enum(["FACTUAL_ERROR", "PERSONA_VIOLATION", "FORMAT_VIOLATION"]),
     failedClaim: z.string().min(1),
     details: z.string().min(1),
   });
   export const AmendmentFeedbackSchema = z.object({ failures: z.array(AmendmentFailureSchema).min(1) });
   ```

   Se eliminan `FactCheckOutputSchema` y `EditorialReviewOutputSchema` (con su `.refine()`). Un `passed: false` sin `reason` usa `editorialViolationFallback(language)`, como hoy. `FORMAT_VIOLATION` es la falla determinística de D13 (UUID en el texto): no es una llamada LLM.
5. **Validación de cobertura dentro del bloque que reintenta Cockatiel** (`coding-rules.md` §3). Un lote es válido si cada `claimRef` pendiente aparece **exactamente una vez**. Las referencias desconocidas a claims se descartan y se loguean. De `evidenceRefs` se descartan las que no existen; si un resultado factual queda sin ninguna, el lote es inválido. Un lote inválido es un intento fallido de la misma llamada contada (D4) y se reintenta igual que un JSON que no parsea.
6. **Lote inválido después de los reintentos** (P9). `FactCheckService` envuelve todo fallo final de sus tres métodos que no sea `DailyQuotaExceededError` ni `RateLimitWaitExceededError` (schema, cobertura, red, circuito abierto) en `VerificationUnavailableError` (`fact-check/fact-check.errors.ts`, con `cause`). `handlePipelineError` lo mapea a `REQUIRES_HUMAN_REVIEW` con `PROVIDER_QUOTA_EXCEEDED` y loguea el detalle (mismo patrón que `VOICE_NOT_CONFIGURED`). No cuenta como enmienda; `withLlmCall` devuelve el cupo; el `DRAFT` queda como está y se retoma al reanudar (punto 8). No se agrega ningún `CheckpointReason`.
7. **Claims versionados** (D8, D16, AC 5.9, AC 5.10). Migración solo con `ADD COLUMN`, el enum nuevo (TEXT en SQLite) y dos `UPDATE` de backfill:
   - `Argument.revision Int @default(0)`: `DebateService.replaceContent` la incrementa en el mismo `update` que pisa el contenido (sin `await` nuevo: se mantiene el invariante "historial después del update" de #35). Backfill: `revision = count(ArgumentHistory)` del argumento.
   - `Claim.revision Int @default(0)`: la `revision` del argumento cuyo contenido se extrajo. Backfill: `revision = count(ArgumentHistory del mismo argumento con createdAt < Claim.createdAt)`. Es exacto para el loop de enmienda: los claims de la versión k se extraen después de que se archivó la versión k-1 y antes de que se archive la k (con el orden viejo de `reviseDraft` y con el de #35, las dos escrituras quedan antes de la extracción siguiente, que sale de una llamada LLM posterior). `edit` y `regenerate` archivan después del debate y no tienen claims posteriores. Sin este backfill, `Claim.revision == Argument.revision` no se cumpliría en ningún argumento viejo con enmiendas: un `DRAFT` en curso al desplegar se volvería a extraer (1 llamada de más) y los `OFFICIAL` viejos quedarían sin "claims de la versión final" para auditar (AC 5.10). Un `UPDATE` con subconsulta correlacionada es barato y se verifica con una consulta antes y después.
   - `Claim.specificity ClaimSpecificity?`: solo en `FACTUAL`. Si el `statement` tiene un dígito, se fuerza `CONCRETE` (red determinística; nunca fuerza `GENERAL`).
   - `FactCheck.reusedFromId String?` (sin FK): el `FactCheck` del que se copió el resultado (D8).
   - "Claims de la versión final" = `Claim.revision == Argument.revision`. Para un `DRAFT`, `Argument.revision` es la cantidad de enmiendas hechas (solo `reviseDraft` modifica un `DRAFT`).
   - `extractClaims` persiste con un solo `createMany` (atómico), después de deduplicar por `statement` normalizado (AC 5.5).
8. **Idempotencia de `processDraft` por versión** (D15, D16). `runRound` busca el `DRAFT` más reciente del agente en la ronda y, si existe, llama a `processDraft` con ese argumento sin `argue`/`respond`. `processDraft` usa `attemptsDone = argument.revision` y, para la versión vigente:
   - si ya tiene claims de esa `revision`, no vuelve a extraer;
   - verifica solo los `FACTUAL` de esa `revision` que no tienen `FactCheck`;
   - rehace siempre la revisión editorial (no se persiste).

   Así, reanudar después de un corte en el `amend` cuesta 1 llamada (editorial) en vez de 3.
9. **Reutilización entre versiones** (D8). Un claim `FACTUAL` de la versión `r` reutiliza el resultado de un claim de una versión anterior del mismo argumento si su `statement` normalizado es igual (NFC, minúsculas, espacios colapsados, sin comillas ni puntuación final) y ese resultado no bloquea con la `specificity` **actual**. Se copia como un `FactCheck` nuevo (mismas veracidad, análisis y fuentes, `reusedFromId`). Cualquier diferencia de texto, aunque sea mínima, se re-verifica: el error va siempre hacia el lado que cuesta tokens, nunca hacia aprobar algo que cambió. No hace falta comparar la Evidence Base (no cambia durante `DEBATING`).
10. **Regla de bloqueo en `FactCheckModule`** (D17). `isBlockingFactCheck(veracity, specificity)` pasa del orquestador a `fact-check/` como función pura, para que la usen la regla de reutilización y el orquestador.

### Contrato de `FactCheckService` (lo consume solo `EpisodeOrchestratorService`)

```ts
getRevisionClaims(argumentId: string, revision: number): Promise<Claim[]>; // [] = no extraído (o extracción vacía)
extractClaims(argumentId: string, revision: number, content: string, provider: ModelProvider,
              language: DebateLanguage, meter?: LlmCallMeter): Promise<Claim[]>;
reuseVerifiedFacts(argumentId: string, revision: number): Promise<Claim[]>; // copia lo reutilizable; devuelve los FACTUAL pendientes
verifyFacts(claims: Claim[], evidenceBase: DebateContext["evidenceBase"], provider: ModelProvider,
            language: DebateLanguage, meter?: LlmCallMeter): Promise<void>; // persiste un FactCheck por claim o lanza
getRevisionFactResults(argumentId: string, revision: number): Promise<Array<{ claim: Claim; factCheck: FactCheck | null }>>;
reviewEditorial(claims: Claim[], argumentContent: string, persona: DebaterPersona, provider: ModelProvider,
                language: DebateLanguage, meter?: LlmCallMeter): Promise<Array<{ claim: Claim; passed: boolean; detail: string | null }>>;
```

El orquestador envuelve en `withLlmCall` solo `extractClaims`, `verifyFacts` y `reviewEditorial`, y solo cuando hay algo que mandar: así "no hay pendientes" no gasta presupuesto (AC 5.4). `LlmCallMeter` está en ADR 0004.

## Consecuencias

- (+) El costo de verificar una versión queda acotado en 3 llamadas (AC 5.1) y la Evidence Base viaja una vez por lote, en vez de una vez por claim: menos tokens de entrada que hoy con ~10 claims.
- (+) Desaparece el único `.refine()` de un schema LLM (#14) y no se agrega ninguno nuevo.
- (+) Un modelo débil del debatiente ya no controla su propio texto. La calidad del control depende de un solo modelo, medible con el conjunto de referencia (AC 5.12).
- (+) `processDraft` queda idempotente por versión, igual que el resto del pipeline. D15 y D16 no necesitan un contador aparte.
- (+) Un lote inválido deja el episodio reanudable desde la UI en vez de trabado (hoy, "error no clasificado").
- (−) `GOOGLE` pasa a ser el único verificador. Si se agota su RPD (500/día), toda verificación frena con `PROVIDER_QUOTA_EXCEEDED`. Un episodio por defecto usa unas 20-35 llamadas `GOOGLE` de verificación, más research, juez y debatientes en `GOOGLE`.
- (−) `gemini-3.5-flash-lite` no está probado como verificador del caso del Estadio Obras. Si falla en la línea de base de AC 5.12, el punto 2 no alcanza para ese caso.
- (−) Un lote con un claim faltante se reintenta entero (más tokens). Optimización posible, fuera del MVP: reintentar solo los faltantes dentro de la misma llamada contada.
- (−) Migración del schema (punto 7) y cambio de firmas internas en `FactCheckService`, `DebateAgent.amend` y `AmendmentFeedback`. `openapi.json`, los eventos SSE y `CheckpointReason` no cambian.
- (−) **Lote inválido que se repite después de reanudar → `FAILED`** (regla de repetición, AC 3.52), igual que una cuota agotada dos veces. Se acepta: si el verificador fijo no puede resolver el mismo borrador después de reintentos y de una reanudación, el problema no se arregla con un tercer intento automático, y el curador ya fue avisado por el texto de AC 3.52. El panel no distingue "lote inválido" de "cuota", pero la causa queda auditada sin cambiar contratos: en el log (`VerificationUnavailableError` con su `cause`) y en `EpisodeLlmCall` (ADR 0004: filas con `succeeded = false` y `operation` `EXTRACT_CLAIMS`/`VERIFY_FACTS`/`EDITORIAL_REVIEW`). Si más adelante hace falta mostrarlo en la UI, es un cambio de contrato aparte (D2), junto con API-21.
- (−) El texto del panel `PROVIDER_QUOTA_EXCEEDED` (spec 003, AC 3.51) habla de "cuota". Para un lote inválido es aproximado. Se resuelve con el mismo criterio que se elija para API-21.

## Alternativas consideradas

- **Extracción y verificación fusionadas** (2 llamadas): imposibilita AC 5.4 (sin extracción previa no se sabe qué cambió antes de pagar la verificación), mezcla la clasificación de D17 con la evidencia (el modelo clasifica sabiendo si encontró respaldo, justo el sesgo que AC 5.23 tiene que evitar), y un lote inválido invalida también la extracción.
- **Hechos y editorial fusionados en una llamada `GOOGLE`** (2 llamadas, posible con el punto 2): mezcla dos roles con criterios distintos (evidencia literal frente a contexto y persona) en el modelo más chico, y duplica el schema. Queda como fallback medible si AC 5.6 no cumple el promedio de 6 llamadas por argumento.
- **Una sola llamada para todo**: suma los dos problemas anteriores.
- **Verificar con el proveedor del debatiente**: la calidad del control depende del sorteo (P8), y `OPENROUTER` tiene 50 RPD por cuenta, que un lote grande con reintentos agota rápido.
- **Lote inválido como intento de enmienda**: castiga al debatiente por un error del verificador y puede terminar en `REJECTED` por `MAX_REVISIONS_EXCEEDED` sin ninguna falla real.
- **Lote inválido con `VALIDATION_INCONSISTENCY`**: el panel de ese motivo deshabilita "Reanudar" y describe otro caso (AC 3.51).
- **`CheckpointReason` nuevo**: rompe D2 (séptimo panel en el dashboard).
- **Identificar claims iguales por similitud o pidiéndole al modelo que los empareje**: "78 %" y "87 %" son casi idénticos por similitud, y el emparejamiento del modelo no es verificable.
- **Contador de enmiendas derivado de `count(ArgumentHistory REJECTED)`**, sin columna: funciona para un `DRAFT`, pero `regenerate` también archiva `REJECTED`, y `Claim.revision` necesita un número estable de todos modos.
