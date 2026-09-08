# Docs — mapa de convención

Este proyecto empezó su documentación (`architecture.md`, `features.md`, `roadmap.md`, `tasks.md`, `coding-rules.md`, `api-contract.md`) en la raíz del repo, antes de adoptar la convención estándar de `docs/` que usa el equipo de agentes (`product-analyst`, `architect`, `roadmap-planner`, `researcher`, etc.). Este archivo mapea esa convención a la realidad actual del repo, para que los agentes (que son genéricos y siempre buscan primero este archivo) sepan dónde leer y escribir sin necesitar instrucciones project-specific hardcodeadas.

## Mapa

| Convención estándar | Dónde vive realmente en este proyecto | Notas |
|---|---|---|
| `docs/product/` | `../features.md` (spec del MVP v1.0) + `docs/product/` para specs nuevas | `features.md` está **congelado** (v1.0) — `product-analyst` lo lee como referencia pero no lo edita. Cualquier feature nueva post-MVP se especifica en `docs/product/`. |
| `docs/architecture/` | `../architecture.md` | Documento vivo — `architect` lo edita in place al tomar nuevas decisiones estructurales. |
| `docs/adr/` | `docs/adr/` (esta carpeta) | Nuevo. Decisiones puntuales van acá como ADR, en vez de seguir expandiendo `architecture.md` indefinidamente. |
| `docs/roadmap/` | `../roadmap.md` + `../tasks.md` | Documentos vivos y activos — `roadmap-planner` los actualiza in place. No se usa una carpeta `docs/roadmap/` separada para no fragmentar la fuente de verdad de qué está hecho. |
| `docs/research/` | `docs/research/` (esta carpeta) | Nuevo. |
| API contract | `../api-contract.md` | Superficie HTTP completa — referencia para `architect` y `backend-engineer`. |
| Convenciones de código | `../coding-rules.md` (backend) y `../../.clinerules/rules.md` (reglas generales del repo, un nivel arriba) | `backend-engineer` y `code-reviewer` deben leerlos antes de tocar código. |

## Por qué no se migró todo a `docs/`

Los documentos de la raíz están activos (última revisión: hoy) y se referencian entre sí. Moverlos habría significado reescribir referencias cruzadas en 6 archivos por una ganancia puramente cosmética. Si en algún momento se decide migrar de verdad, actualizar este archivo es lo único que hace falta para que todo el sistema de agentes siga funcionando sin tocar los agentes en sí.
