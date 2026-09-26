# Docs — Dashboard (front)

Carpeta creada el 2026-09-24, antes de que existiera código. `apps/dashboard/` ya existe como scaffold Next.js vacío (creado por `../../../docs/product/002-workspace-restructure.md`). Esta carpeta guarda la documentación que es **puramente del front**, separada de los docs de raíz del repo (que siguen siendo específicos del backend/infraestructura compartida).

## Convención de dónde vive cada cosa (acordada 2026-09-24, ver `decision-log.md` raíz #28)

| Qué es | Dónde vive |
|---|---|
| Specs puramente de backend/infra (OpenAPI, workspace, contracts, video) | `../../../docs/product/00X-*.md` + `roadmap.md`/`tasks.md`/`decision-log.md` de la raíz del repo |
| Algo que toca al front pero no es una decisión del front en sí (ej. "una vez que exista `openapi.json`, el front puede generar tipos") | `../../../frontend-notes.md` |
| Decisiones/roadmap/tasks puramente del dashboard (framework, páginas, auth, UX) | Acá (`roadmap.md`, `tasks.md`, `decision-log.md` de esta carpeta) |

## Estado actual

F1 implementada (2026-09-26, rama `feat/dashboard-f1`): login, rutas protegidas, cliente tipado desde `openapi.json`, los dos layouts raíz (panel y showcase) y páginas placeholder donde van las pantallas de F2-F4. Estado ítem por ítem en `tasks.md` §1. La UI real está especificada en `../../../docs/product/003-dashboard-ui.md` (revisada por `architect`, auth en `../../../docs/adr/0001-auth-sesion-nest-mismo-origen.md`). Secuenciación en `roadmap.md` y tareas en `tasks.md` de esta carpeta; lo que bloquea la F2 es el backend de la spec 004 (API-17).
