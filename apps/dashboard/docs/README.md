# Docs — Dashboard (front)

Carpeta creada el 2026-09-24, antes de que existiera código. `apps/dashboard/` ya existe como scaffold Next.js vacío (creado por `../../../docs/product/002-workspace-restructure.md`). Esta carpeta guarda la documentación que es **puramente del front**, separada de los docs de raíz del repo (que siguen siendo específicos del backend/infraestructura compartida).

## Convención de dónde vive cada cosa (acordada 2026-09-24, ver `decision-log.md` raíz #28)

| Qué es | Dónde vive |
|---|---|
| Specs puramente de backend/infra (OpenAPI, workspace, contracts, video) | `../../../docs/product/00X-*.md` + `roadmap.md`/`tasks.md`/`decision-log.md` de la raíz del repo |
| Algo que toca al front pero no es una decisión del front en sí (ej. "una vez que exista `openapi.json`, el front puede generar tipos") | `../../../frontend-notes.md` |
| Decisiones/roadmap/tasks puramente del dashboard (framework, páginas, auth, UX) | Acá (`roadmap.md`, `tasks.md`, `decision-log.md` de esta carpeta) |

## Estado actual

Scaffold vacío, sin páginas propias. La UI real está especificada en `../../../docs/product/003-dashboard-ui.md` (revisada por `architect`, auth en `../../../docs/adr/0001-auth-sesion-nest-mismo-origen.md`). Secuenciación en `roadmap.md` y tareas en `tasks.md` de esta carpeta; el primer bloqueante real es API-8 (auth) en el backend.
