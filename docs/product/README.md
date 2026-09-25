# Product specs — AI Trend Debates

Un archivo por feature/spec nueva, mantenido por el agente `product-analyst`: problema, user stories, acceptance criteria, edge cases, MVP vs nice-to-have, dependencias con otras features.

El spec del MVP v1.0 (Features 1-10) está **congelado** en `../../features.md` — no se edita acá. Esta carpeta es para especificar trabajo nuevo, posterior al MVP congelado.

## Registro

- [`001-openapi-contract-zod.md`](001-openapi-contract-zod.md) — contrato OpenAPI generado desde Zod. Implementada (2026-09-24).
- [`002-workspace-restructure.md`](002-workspace-restructure.md) — monorepo pnpm + Turborepo (`apps/api`, `apps/dashboard`, `packages/contracts`, `packages/video`). Implementada (2026-09-24).
- [`003-dashboard-ui.md`](003-dashboard-ui.md) — dashboard: panel de curación privado + showcase público. Escrita por `product-analyst` y revisada por `architect` (2026-09-25), sin implementar. Decisión de auth en [`../adr/0001-auth-sesion-nest-mismo-origen.md`](../adr/0001-auth-sesion-nest-mismo-origen.md).
- [`004-debate-language.md`](004-debate-language.md) — idioma del debate por episodio (ES neutro latinoamericano / EN / PT), persistido en `Episode.language`. Escrita por `product-analyst` y revisada por `architect` (2026-09-25), sin implementar. Modelo de voces en [`../adr/0002-voces-por-agente-e-idioma.md`](../adr/0002-voces-por-agente-e-idioma.md).
