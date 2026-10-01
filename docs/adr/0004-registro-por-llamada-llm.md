# 0004: Registro por llamada LLM (modelo y tokens) en `EpisodesModule`

Estado: **propuesto** (2026-10-01). Origen: spec `docs/product/005-verification-cost.md` (D10, AC 5.8). Lo propone `architect` en su revisión de la spec 005; falta la aceptación del usuario. Cumple el registro de tokens que exige `features.md` Feature 2 y que nunca se implementó.

## Contexto

- `EpisodeUsage.inputTokens`/`outputTokens` existen (`schema.prisma`) y siempre valen 0. Nadie los escribe.
- `LlmRequestLog` es el estado del limitador de RPM/RPD (`ai/llm-rate-limiter.service.ts`): una fila por **intento** (se escribe en `acquire`, antes de la llamada), sin episodio, y `prune` borra las filas de más de 48 h. No sirve como registro de auditoría.
- Los servicios de dominio (`AgentsService`, `FactCheckService`, `ResearchService`) no conocen `Episode` (`architecture.md` §3). Solo `EpisodeBudgetService.withLlmCall` sabe a qué episodio pertenece una llamada.
- AI SDK 6 (`ai@6.0.289`) devuelve en `generateObject` `result.usage.inputTokens`/`outputTokens` (pueden ser `undefined`) y `result.response.modelId`. `NoObjectGeneratedError` trae `usage` y `response` del intento fallido.

## Decisión

1. **Tabla nueva, dueña `EpisodesModule`**:

   ```prisma
   enum LlmOperation {
     RESEARCH
     ARGUE
     RESPOND
     AMEND
     EXTRACT_CLAIMS
     VERIFY_FACTS
     EDITORIAL_REVIEW
     JUDGE
     REGENERATE
     REGENERATE_VERDICT
   }

   model EpisodeLlmCall {
     id           String        @id @default(uuid())
     episodeId    String
     episode      Episode       @relation(fields: [episodeId], references: [id], onDelete: Cascade)
     operation    LlmOperation
     provider     ModelProvider
     modelId      String        // el del último intento; nunca vacío
     attempts     Int           // intentos reportados (reintentos de Cockatiel incluidos)
     succeeded    Boolean
     inputTokens  Int?          // suma de los intentos que informaron tokens; null si ninguno
     outputTokens Int?
     argumentId   String?       // sin FK: es un registro, como VerdictHistory
     createdAt    DateTime      @default(now())

     @@index([episodeId, createdAt])
   }
   ```

   Una fila por cada `withLlmCall`, haya salido bien o no. No se expone en la API (D2). La migración es un `CREATE TABLE` más su índice.
2. **Medidor explícito, no contexto implícito.** En `modules/ai/llm-call-report.ts`:

   ```ts
   export interface LlmCallReport {
     provider: ModelProvider; // lo conoce el servicio (research usa su propio EXTRACTION_PROVIDER)
     modelId: string;
     inputTokens: number | undefined;
     outputTokens: number | undefined;
     succeeded: boolean;
   }
   export type LlmCallMeter = (report: LlmCallReport) => void;
   // Arma el reporte desde un GenerateObjectResult o un NoObjectGeneratedError;
   // modelId cae en el modelId del LanguageModel si la respuesta no lo trae.
   export function toLlmCallReport(provider: ModelProvider, model: LanguageModel, outcome: unknown, succeeded: boolean): LlmCallReport;
   ```

   Cada método que llama a `generateObject` recibe un `meter?: LlmCallMeter` opcional (último parámetro) y lo invoca **una vez por intento**, dentro del bloque que reintenta Cockatiel. Aplica a `DebateAgent.argue/respond/amend`, `AgentsService.judge`, `ResearchService.research` y los tres métodos de verificación (ADR 0003).
3. **`EpisodeBudgetService.withLlmCall(episodeId, call: { operation: LlmOperation; argumentId?: string }, fn: (meter: LlmCallMeter) => Promise<T>)`**:
   - mantiene el incremento atómico de `llmCalls` y su devolución si `fn` falla (D4 sin cambios);
   - acumula los reportes en memoria mientras corre `fn`;
   - al terminar, bien o mal, inserta la fila de `EpisodeLlmCall` y suma los tokens reportados a `EpisodeUsage` con `increment`. Los tokens de intentos fallidos también se suman: son costo real;
   - si no hubo ningún reporte (por ejemplo, `DailyQuotaExceededError` antes de llamar al modelo), no inserta nada.
4. **`LlmRequestLog` no cambia.** Sigue siendo el estado del limitador, sin episodio y con poda.

## Consecuencias

- (+) AC 5.8 se cumple, y un error como el del Estadio Obras pasa a ser atribuible: `operation = VERIFY_FACTS` más `modelId`.
- (+) `ai/` no conoce a `Episode`, y los servicios de dominio solo reciben una función opcional. Los tests existentes compilan sin pasar `meter`.
- (+) El `snapshot` del checkpoint (la fila de `EpisodeUsage`) ya incluye los tokens, sin cambios.
- (−) Cambian las firmas de `DebateAgent` (`shared/contracts/`) y de todos los call sites de `withLlmCall` (orquestador, `regenerate`, `regenerate-verdict`).
- (−) Una fila por llamada: unas 30-60 por episodio. Sin poda (es auditoría, Feature 10); se borra en cascada con el `Episode`.
- (−) `EpisodeUsage.inputTokens` suma también intentos fallidos, así que no es exactamente "tokens de las llamadas contadas en `llmCalls`". Es lo que sirve para comparar el costo real (D10).

## Alternativas consideradas

- **Agregar `modelId`, tokens y `episodeId` a `LlmRequestLog`**: se escribe antes de la llamada (todavía no hay tokens), es por intento, se poda a las 48 h y obligaría a `ai/` a conocer episodios.
- **`AsyncLocalStorage` abierto por `withLlmCall` y leído en `ai/`**: no cambia ninguna firma, pero oculta el acoplamiento y depende de que el contexto sobreviva a Cockatiel y al mutex del limitador. Se prefiere el parámetro explícito.
- **Que los servicios devuelvan `{ result, report }`**: cambia el tipo de retorno de todo `DebateAgent` y de cada consumidor, y no captura los intentos fallidos.
- **Solo sumar a `EpisodeUsage`, sin tabla por llamada**: no cumple "qué modelo atendió cada llamada" (D10).
