# Tasks — Dashboard (front)

Tracking de estado puramente del front. Convención: `[x]` hecho, `[ ]` pendiente, `[~]` empezado/parcial. Última revisión: 2026-09-24 (creación inicial, nada implementado).

## 0. Bloqueantes (backend/infra, no se trackean acá)

- [ ] `docs/product/001-openapi-contract-zod.md` mergeada (raíz del repo)
- [ ] `docs/product/002-workspace-restructure.md` mergeada (raíz del repo) — crea el scaffold vacío de `apps/dashboard`

## 1. Scaffold real + tipos — sin empezar

- [ ] `apps/dashboard` levanta con `pnpm dev`
- [ ] Tipos generados desde `openapi.json` (`openapi-typescript`)
- [ ] Cliente HTTP tipado contra la API
- [ ] Layout base + navegación

## 2. Panel de curación (privado) — sin empezar

- [ ] Lista de episodios
- [ ] Detalle de episodio
- [ ] Acciones de curación (`approve`/`edit`/`regenerate`/`reject`/`resume`/`regenerate-audio`)
- [ ] Suscripción SSE en vivo
- [ ] UI por cada `reason` de `REQUIRES_HUMAN_REVIEW`

## 3. Preview de video — sin empezar

- [ ] Embed `@remotion/player` contra el manifest
- [ ] Reproducción de audio por segmento (URLs firmadas)

## 4. Vista pública / showcase — sin empezar, bloqueada por auth

- [ ] Estrategia de autenticación que separe panel privado de vista pública (gap sin resolver, `decision-log.md` #1)
- [ ] Listado de episodios terminados
- [ ] Reproducción del `.mp4` final

## Referencias

- `roadmap.md` (esta carpeta) — secuenciación y objetivo de cada fase.
- `decision-log.md` (esta carpeta) — decisiones ya tomadas (framework, dependencias).
- `docs/product/003-dashboard-ui.md` — spec de UI, todavía no escrita.
