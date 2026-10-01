# Product specs — AI Trend Debates

Un archivo por feature/spec nueva, mantenido por el agente `product-analyst`: problema, user stories, acceptance criteria, edge cases, MVP vs nice-to-have, dependencias con otras features.

El spec del MVP v1.0 (Features 1-10) está **congelado** en `../../features.md` — no se edita acá. Esta carpeta es para especificar trabajo nuevo, posterior al MVP congelado.

## Registro

- [`001-openapi-contract-zod.md`](001-openapi-contract-zod.md) — contrato OpenAPI generado desde Zod. Implementada (2026-09-24).
- [`002-workspace-restructure.md`](002-workspace-restructure.md) — monorepo pnpm + Turborepo (`apps/api`, `apps/dashboard`, `packages/contracts`, `packages/video`). Implementada (2026-09-24).
- [`003-dashboard-ui.md`](003-dashboard-ui.md) — dashboard: panel de curación privado + showcase público. Escrita por `product-analyst` y revisada por `architect` (2026-09-25), sin implementar. Decisión de auth en [`../adr/0001-auth-sesion-nest-mismo-origen.md`](../adr/0001-auth-sesion-nest-mismo-origen.md).
- [`004-debate-language.md`](004-debate-language.md) — idioma del debate por episodio (ES neutro latinoamericano / EN / PT), persistido en `Episode.language`. Escrita por `product-analyst` y revisada por `architect` (2026-09-25), sin implementar. Modelo de voces en [`../adr/0002-voces-por-agente-e-idioma.md`](../adr/0002-voces-por-agente-e-idioma.md).
- [`005-verification-cost.md`](005-verification-cost.md) — costo en llamadas LLM de la verificación de argumentos (fact-check + loop de enmienda): verificación en 3 llamadas en serie con `GOOGLE` como verificador fijo, enmienda con todas las fallas, `UNSUPPORTED` que bloquea solo datos concretos, continuar el `DRAFT` al reanudar, registro de tokens y modelo por llamada, y recalibración de `maxLlmCalls`. Escrita por `product-analyst` y revisada por `architect` (2026-10-01, aprobada con cambios, aplicados), sin implementar. Mecanismos en [`../adr/0003-verificacion-en-lote-proveedor-fijo.md`](../adr/0003-verificacion-en-lote-proveedor-fijo.md) y [`../adr/0004-registro-por-llamada-llm.md`](../adr/0004-registro-por-llamada-llm.md) (propuestos).
