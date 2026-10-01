# ADRs — AI Trend Debates

Un archivo por decisión arquitectónica significativa, mantenido por el agente `architect`. Convención de nombre: `NNNN-titulo-corto.md` (ej. `0001-provider-abstraction-vercel-ai-sdk.md`).

Cada ADR cubre: contexto, decisión, consecuencias, y alternativas consideradas. Para el estado actual de la arquitectura (no el historial de cómo se llegó ahí), ver `../../architecture.md`.

## Registro

- [`0001-auth-sesion-nest-mismo-origen.md`](0001-auth-sesion-nest-mismo-origen.md) — Auth del curador: sesión emitida y validada por Nest, dashboard Next como único origen público (2026-09-25, spec 003). Alcance de `src/proxy.ts` aclarado el 2026-09-26.
- [`0002-voces-por-agente-e-idioma.md`](0002-voces-por-agente-e-idioma.md): voces TTS por agente, idioma y proveedor en la tabla `AgentVoice`. Reemplaza el shape Json de `decision-log.md` #20 (2026-09-25, spec 004).
- [`0003-verificacion-en-lote-proveedor-fijo.md`](0003-verificacion-en-lote-proveedor-fijo.md): **propuesto**. Verificación de un borrador en 3 llamadas en serie (extracción, hechos en lote, editorial en lote) con `GOOGLE` como verificador fijo, claims versionados por `Argument.revision` y lote inválido mapeado a `PROVIDER_QUOTA_EXCEEDED` (2026-10-01, spec 005).
- [`0004-registro-por-llamada-llm.md`](0004-registro-por-llamada-llm.md): **propuesto**. Tabla `EpisodeLlmCall` (modelo, tokens, intentos por llamada) escrita por `EpisodeBudgetService.withLlmCall` a partir de un medidor explícito; tokens sumados a `EpisodeUsage` (2026-10-01, spec 005).

Las decisiones anteriores a este registro siguen documentadas directamente en `architecture.md`.
