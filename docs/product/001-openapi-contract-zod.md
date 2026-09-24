# 001 — Contrato OpenAPI generado desde Zod

Estado: **implementada y verificada contra el servidor real** (2026-09-24 — ver `decision-log.md` #29 para el proceso completo, incluidos los hallazgos reales que ni la spec ni el plan de implementación podían anticipar sin correr el código). Ajustada el 2026-09-24 tras revisión contra el estado real del repo antes de implementar (`decision-log.md` #28) — el texto original lo trajo el usuario ya escrito; lo que sigue conserva su estructura y sus decisiones, con las correcciones marcadas donde el repo real no coincidía con lo asumido.

## Contexto

El backend define sus contratos con Zod 4 y valida entradas y salidas de agentes con esos schemas. El frontend todavía no existe. Antes de escribir una sola pantalla, necesitamos un contrato de API tipado y versionado, para que el dashboard no duplique tipos a mano y se desincronice en silencio.

El resultado de esta tarea es un `openapi.json` commiteado en el repo y un endpoint `/docs` navegable.

## Decisiones

Cada decisión incluye su razón. La razón es parte del contrato: si se propone una alternativa a mitad de la implementación, tiene que refutar la razón, no solo ofrecer otra opción.

- **Usamos `@nestjs/swagger` + `nestjs-zod`.** Porque el backend ya define los contratos en Zod 4 y duplicarlos como DTOs decorados con `class-validator` los desincroniza. `nestjs-zod` genera el documento OpenAPI a partir de `z.toJSONSchema`, que es soporte nativo de Zod 4.
- **Los schemas expuestos por la API viven separados de los schemas de agentes.** Porque los schemas de agentes son contratos internos que cambian cuando cambia un prompt. Exponerlos directamente ataría la API pública a un detalle de implementación. **Nota de la revisión**: esto ya se cumple hoy — cada módulo con superficie HTTP (`episodes/`) tiene su propio `dto/` (`coding-rules.md` §3: "Los DTOs de la capa HTTP son schemas Zod separados de los contratos de agentes"). No hace falta una ubicación nueva, esta tarea reusa `modules/episodes/dto/` tal cual existe.
- **`openapi.json` se commitea al repo.** Porque es el artefacto de contrato: el diff en cada PR muestra exactamente qué cambió de la API, y el frontend puede generar tipos sin levantar el backend.
- **Los `operationId` se declaran explícitamente.** Porque el default de Nest es `EpisodesController_findAll`, y de ahí salen nombres inutilizables en el cliente generado.

## No-objetivos

Fuera de alcance en esta tarea. Si algo de esto parece necesario, parar y preguntar:

- No se crea ni se modifica ningún endpoint. Solo se documenta lo que existe.
- No se refactorizan los schemas de agentes.
- No se toca nada del dashboard ni se genera código de cliente.
- No se reestructura el repo a workspace (eso es la spec `002-workspace-restructure.md`).
- No se agrega autenticación ni control de acceso al endpoint de docs.

## Restricciones técnicas

- **Usar `cleanupOpenApiDoc`, no `patchNestJsSwagger`.** `patchNestJsSwagger` es la solución vieja: parcheaba internals de `@nestjs/swagger` y quedó deprecada por frágil. La forma correcta es llamar `cleanupOpenApiDoc` sobre el documento generado antes de pasárselo a `SwaggerModule.setup`. Esto va a contradecir la mayoría de los tutoriales que se encuentran; la versión correcta es la de la documentación actual de `nestjs-zod`.
- **Leer las versiones reales de `package.json` antes de escribir código.** Aplica a `@nestjs/swagger`, `nestjs-zod` y `zod` — ninguno de los tres está instalado todavía (confirmado en la revisión, `zod` sí está en `^4.4.3`, los otros dos hay que agregarlos). No asumir APIs de mayores anteriores.
- **El `ZodValidationPipe` se registra globalmente.** Los DTOs creados con `createZodDto` dependen de que el pipe esté activo para validar. Sin eso, la documentación se genera pero la validación no corre. **Nota de la revisión, alcance real**: el proyecto ya tiene un `ZodValidationPipe` propio (`src/shared/http/zod-validation.pipe.ts`), aplicado hoy *por parámetro* (`@Body(new ZodValidationPipe(Schema))`, ver `episodes.controller.ts`), y los 6 DTOs existentes en `modules/episodes/dto/` son schemas Zod planos (`export const XSchema = ...; export type XDto = z.infer<...>`), no clases `createZodDto`. El `ZodValidationPipe` de `nestjs-zod` es una clase distinta con el mismo nombre. Implementar esta tarea implica **reemplazar** el pipe propio y migrar los 6 DTOs existentes al patrón `createZodDto` — no es un agregado aislado, es un cambio de patrón de validación en todos los endpoints ya construidos de `EpisodesController`. Dimensionar el trabajo con esto en cuenta.
- **Las respuestas se declaran con `@ZodResponse`.** Para que el schema de salida quede en el documento y la serialización use el schema. Un handler sin respuesta declarada queda documentado como `any`. **Nota de la revisión**: hoy ninguna respuesta `GET` del backend es un schema Zod — `mapEpisodeDetail`/`EpisodeDetailResponse` (`episode-detail.mapper.ts`) y `RemotionManifest` (`src/modules/render/remotion-manifest.types.ts`) son interfaces TS planas, sin `.parse()` en runtime (precedente documentado en `decision-log.md` #27: las respuestas `GET` de este proyecto nunca se validaron con Zod, solo los DTOs de entrada). Para que `@ZodResponse` documente algo real en estos dos casos hay que migrarlos a schemas Zod como parte de esta tarea — no existen ya hechos en otro lado.
- **SSE necesita tratamiento manual.** OpenAPI no modela streams de eventos. El endpoint se documenta con content type `text/event-stream`, y además hay que registrar la unión de tipos de evento como schema nombrado para que aterrice en `components.schemas`. **Nota de la revisión, alcance real**: hoy `EpisodeEventsService.emit(episodeId, type: string, data?: unknown)` (`episode-events.service.ts`) está completamente destipado — no existe ningún schema Zod para ninguno de los 6 eventos de Feature 8 (`research.started`, `agent.thinking`, `fact_check.completed`, `argument.approved`, `episode.pending_review`, `episode.requires_review`). Sus shapes solo están documentados como ejemplos en prosa/JSON en `features.md` Feature 8. Este paso de la tarea es escribir 6 schemas Zod nuevos desde esa prosa y unirlos en un discriminated union — no "registrar" algo que ya exista.

## Plan de implementación

1. Instalar `@nestjs/swagger` y `nestjs-zod` (pnpm — ver `002-workspace-restructure.md` para el cambio de gestor de paquetes).
2. Migrar `RemotionManifest` (`src/modules/render/remotion-manifest.types.ts`) y `EpisodeDetailResponse` (`episode-detail.mapper.ts`) de interfaces TS planas a schemas Zod. Queda co-ubicado donde está hoy (no se crea `packages/contracts` acá, eso es la spec 002, que después lo reubica tal cual).
3. Crear los schemas Zod de los 6 eventos SSE de Feature 8 (nuevos, no existen hoy) y su discriminated union.
4. Reemplazar el `ZodValidationPipe` propio (`shared/http/zod-validation.pipe.ts`) y los 6 DTOs de `modules/episodes/dto/` por el patrón `createZodDto` de `nestjs-zod`, registrando su `ZodValidationPipe` globalmente.
5. Anotar cada handler de `EpisodesController`/`NotificationsController` con su `operationId` explícito y su `@ZodResponse`.
6. Configurar `DocumentBuilder` con título, versión y tags por módulo. Montar `SwaggerModule.setup` pasando el documento por `cleanupOpenApiDoc`.
7. Documentar el endpoint SSE (`GET /episodes/:id/events`) y registrar la unión de eventos del paso 3 como schema nombrado.
8. Escribir `scripts/generate-openapi.ts`: crea la app sin ponerla a escuchar, construye el documento, lo escribe a `openapi.json` en la raíz, cierra la app. Exponerlo como script `openapi:generate`.
9. Generar y commitear `openapi.json`.
10. Registrar la decisión en `decision-log.md`.

## Criterio de aceptación

Comandos que tienen que correr y pasar. No se considera terminada la tarea hasta que todos den verde:

- `pnpm openapi:generate && git diff --exit-code openapi.json` en un árbol limpio devuelve 0. Es decir: regenerar no produce cambios.
- El servidor levanta y `/docs` renderiza sin errores en consola.
- `components.schemas` del `openapi.json` contiene el schema de eventos de SSE.
- Ningún `operationId` del documento tiene la forma `*Controller_*`.
- `pnpm build` y los tests existentes siguen pasando.
- Un archivo temporal de prueba que importe los tipos generados con `openapi-typescript` compila sin errores. (El archivo de prueba se borra después; no forma parte del entregable.)

## Bitácora

Implementada y documentada en `decision-log.md` #29 — incluye la decisión de `nestjs-zod` y su razón, la separación entre schemas de API y schemas de agentes, la decisión de commitear `openapi.json`, el reemplazo completo del `ZodValidationPipe` propio por el de `nestjs-zod` (posible 1:1, no una coexistencia — corrige la nota de la revisión previa), y los hallazgos reales encontrados implementando: `z.date()`/`z.undefined()` no representables en JSON Schema bajo Zod 4, `createZodDto` no envuelve `z.union`/`z.discriminatedUnion`, un bug propio de `import type` que dejaba el pipe global sin validar nada, y el alcance real de `@ZodResponse` en `POST /episodes/:id/actions/:action` (no se pudo documentar, comparte handler entre 3 shapes de respuesta distintos).

La revisión previa a esta spec (por qué el texto original se ajustó, antes de implementar) quedó documentada en `decision-log.md` #28.

**Pendiente real, no bloqueante**: `@ZodResponse` en `edit`/`regenerate`/`regenerate-audio`/`audio/url` (fuera del alcance explícito de esta primera pasada) y en `POST /episodes/:id/actions/:action` en general (bloqueado por compartir handler entre `Episode`/`Argument`/`AudioAsset` — requeriría partir el endpoint, fuera de alcance). `ResumeActionBodySchema` no tiene DTO por la misma limitación de `createZodDto` con uniones.
