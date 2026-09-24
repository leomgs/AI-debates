# Docs — Dashboard (front)

Carpeta creada el 2026-09-24 como **placeholder** — `apps/dashboard/` todavía no existe como aplicación real (ni `package.json`, ni Next.js instalado, nada). Se crea recién cuando se implemente `../../../docs/product/002-workspace-restructure.md`, que hoy solo prevé un scaffold vacío. Esta carpeta guarda, desde antes de que exista código, la documentación que es **puramente del front**, separada de los docs de raíz del repo (que siguen siendo específicos del backend/infraestructura compartida).

## Convención de dónde vive cada cosa (acordada 2026-09-24, ver `decision-log.md` raíz #28)

| Qué es | Dónde vive |
|---|---|
| Specs puramente de backend/infra (OpenAPI, workspace, contracts, video) | `../../../docs/product/00X-*.md` + `roadmap.md`/`tasks.md`/`decision-log.md` de la raíz del repo |
| Algo que toca al front pero no es una decisión del front en sí (ej. "una vez que exista `openapi.json`, el front puede generar tipos") | `../../../frontend-notes.md` |
| Decisiones/roadmap/tasks puramente del dashboard (framework, páginas, auth, UX) | Acá (`roadmap.md`, `tasks.md`, `decision-log.md` de esta carpeta) |

## Estado actual

Nada implementado todavía. Ver `roadmap.md` de esta carpeta — depende de que `002-workspace-restructure.md` (backend) cree el scaffold de `apps/dashboard` antes de que el trabajo de front pueda arrancar.
