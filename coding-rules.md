# Coding Rules — AI Trend Debates

Reglas concretas, no aspiracionales. El objetivo es que cualquier código nuevo (generado por Cline o escrito a mano) sea indistinguible en estilo del resto, sin tener que releer todo el proyecto cada vez.

## 1. Estructura de un módulo

Todo módulo de dominio (`research`, `agents`, `debate`, `fact-check`, `tts`, `render`, `episodes`) sigue el mismo layout:

```
modules/<nombre>/
  <nombre>.module.ts
  <nombre>.service.ts
  <nombre>.controller.ts       ← solo si el módulo expone endpoints (episodes sí, agents no)
  <nombre>.service.spec.ts
  dto/
    <accion>.dto.ts
```

Los controllers no contienen lógica de negocio — parsean/validan el request y delegan al service en la primera línea. Si un controller tiene un `if` que no es de validación de shape, esa lógica está en el lugar equivocado.

## 2. Prisma

- Nunca `new PrismaClient()` fuera de `shared/prisma/prisma.service.ts`. Todo acceso a datos pasa por `PrismaService` inyectado.
- Un módulo de dominio solo hace queries sobre las tablas que le pertenecen (ver `architecture.md` sección 6). Si `AgentsModule` necesita datos de `Debate`, eso es una señal de que la llamada debería venir de `EpisodesModule` orquestando, no de un import cruzado.
- Migraciones: un commit = una migración con nombre descriptivo (`add_episode_checkpoint_history`, no `update_schema`).

## 3. Contratos Zod (`shared/contracts/`)

- Toda llamada a un LLM que espera output estructurado usa `generateObject` del AI SDK con el schema de Zod correspondiente — nunca se parsea un `generateText` a mano con regex o `JSON.parse`.
- El `.parse()` de Zod va **dentro** del bloque que Cockatiel reintenta (ver sección 4), no afuera. Un output que no matchea el schema es un fallo de la llamada, no un caso aparte a manejar después — así una respuesta mal formada dispara el mismo retry que un timeout.
- Los DTOs de la capa HTTP (`03-api/api-contract.md`) son schemas Zod separados de los contratos de agentes — no reutilizar `ArgumentDraftSchema` como DTO de un endpoint. Son capas distintas aunque el shape a veces coincida.

## 4. Resiliencia (Cockatiel)

Patrón fijo para cualquier llamada a un servicio externo (LLM, búsqueda web, TTS):

```typescript
import { retry, handleAll, ExponentialBackoff, circuitBreaker, wrap } from "cockatiel";

const retryPolicy = retry(handleAll, { maxAttempts: 3, backoff: new ExponentialBackoff() });
const breakerPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: 10_000,
  breaker: new ConsecutiveBreaker(5),
});
const policy = wrap(retryPolicy, breakerPolicy);

async function generateArgument(input: DebateContext): Promise<ArgumentDraft> {
  return policy.execute(async () => {
    const result = await generateObject({ model, schema: ArgumentDraftSchema, prompt: buildPrompt(input) });
    return ArgumentDraftSchema.parse(result.object); // dentro del retry — ver sección 3
  });
}
```

- Cada módulo define su propia instancia de `policy` para su integración — no se comparte una policy global entre `agents`, `research` y `tts` (fallan distinto, ver `architecture.md` sección 5).
- Si `policy.execute` termina agotando reintentos, deja propagar la excepción — no se traga el error ni se devuelve un valor por defecto. El módulo que orquesta (`episodes`) es quien decide qué transición de estado corresponde.

## 5. Errores de dominio → transiciones de estado

Los módulos de dominio lanzan excepciones tipadas, no devuelven `null`/`undefined` para señalar fallos:

```typescript
export class InsufficientEvidenceError extends Error {}
export class UsageLimitExceededError extends Error {}
```

Solo `EpisodesModule` las captura y decide la transición (`REQUIRES_HUMAN_REVIEW` con la `reason` correspondiente, o `FAILED` si ya venía de un `Resume` fallido — ver `architecture.md` sección 4). Ningún otro módulo conoce `EpisodeStatus` ni `CheckpointReason`.

## 6. Único escritor de `Episode.status`

Encapsulado en un solo servicio, `EpisodeStateService` (dentro de `episodes/`), con un método por transición válida (`markResearching()`, `requireHumanReview(reason, checkpoint)`, `markFailed()`, etc.) — nunca `episode.status = "X"` seteado directo en otro lugar del código. Si hace falta una transición nueva, se agrega un método acá, no un `update` suelto en otro service.

## 7. Naming

- Modelos y enums de Prisma: `PascalCase`, singular (`Episode`, no `Episodes`).
- Archivos: `kebab-case` (`agent-contracts.ts`, no `agentContracts.ts`).
- Los valores de enum se escriben `SCREAMING_SNAKE_CASE` tanto en `schema.prisma` como en los `z.enum([...])` de `shared/contracts/` — deben ser el mismo string literal en ambos lados (no hay mapeo intermedio).

## 8. Variables de entorno

Toda variable de entorno nueva se agrega primero a `shared/config/env.schema.ts` (Zod) y a `.env.example` — nunca `process.env.X` leído directo en otro archivo. El acceso siempre pasa por `ConfigService` inyectado, tipado contra `Env`. `AppModule` valida el entorno al arrancar (`ConfigModule.forRoot({ validate: validateEnv })`): si falta una key requerida, el proceso no levanta — no falla a mitad de un episodio con un error críptico del proveedor.

## 9. Tests

- Cada `*.service.ts` tiene su `*.service.spec.ts` en el mismo módulo.
- Los tests de un módulo de dominio (`agents`, `fact-check`, etc.) mockean el LLM/servicio externo — nunca hacen una llamada real. `EpisodesModule` es el único con tests de integración que orquestan varios módulos juntos (con todo mockeado en el borde externo).
- El detalle de estrategia de testing se documenta aparte cuando exista al menos un módulo implementado (`04-development/testing-strategy.md`, todavía no escrito — ver `architecture.md`).
