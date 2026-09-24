# Roadmap — Dashboard (front)

Documento de secuenciación puramente del front. Ver `README.md` de esta carpeta para qué queda afuera (eso vive en los docs de raíz del repo o en `frontend-notes.md`).

## Objetivo

Un dashboard Next.js (`decision-log.md` #1) con dos superficies: un panel interno de curación de episodios (consume las acciones de `api-contract.md` §3 — `approve`/`edit`/`regenerate`/`reject`/`resume`/`regenerate-audio`, y el stream SSE de `GET /episodes/:id/events`) y una vista pública de episodios terminados (showcase/portfolio).

## Bloqueante actual

**Nada de esto puede arrancar todavía.** Depende, en orden:

1. `../../../docs/product/001-openapi-contract-zod.md` — sin `openapi.json`, no hay contrato tipado del que generar tipos para el dashboard.
2. `../../../docs/product/002-workspace-restructure.md` — crea `apps/dashboard` como scaffold vacío (Next.js, sin páginas) y deja armado el workspace (pnpm + Turborepo) para que este proyecto pueda importar `@contracts`/`@video` sin publicar nada.

## Fases (una vez desbloqueado)

### Fase 1 — Scaffold real + tipos

- [ ] Confirmar que `apps/dashboard` (creado vacío por la spec 002) levanta con `pnpm dev` dentro del workspace.
- [ ] Generar tipos desde `openapi.json` (`openapi-typescript`) y wirear un cliente HTTP tipado contra la API.
- [ ] Layout base + navegación entre panel de curación y vista pública.

### Fase 2 — Panel de curación (privado)

- [ ] Lista de episodios (`GET /episodes`, filtrable por status).
- [ ] Detalle de episodio (`GET /episodes/:id`) + acciones de curación (`api-contract.md` §3).
- [ ] Suscripción en vivo a `GET /episodes/:id/events` (SSE) mientras un episodio corre.
- [ ] Resolución de las 4 `reason` de `REQUIRES_HUMAN_REVIEW` con UI propia por caso (`frontend-notes.md` ya tiene la primera entrada real: `VALIDATION_INCONSISTENCY`).

### Fase 3 — Preview de video (depende de `packages/video`)

- [ ] Embed de `@remotion/player` contra el manifest de un episodio `READY_FOR_RENDER`/posterior (`GET /episodes/:id/manifest`).
- [ ] Reproducción de audio por segmento vía las URLs firmadas (AC 6.1).

### Fase 4 — Vista pública / showcase

- [ ] **Bloqueada por el gap de autenticación** (`decision-log.md` #1) — no exponer nada más allá de uso local hasta resolver cómo se separa esta superficie del panel de curación.
- [ ] Listado de episodios `COMPLETED` (o el estado que corresponda una vez que exista Feature 9 — worker de Remotion, todavía sin arrancar, ver `roadmap.md` de la raíz del repo).
- [ ] Reproducción del `.mp4` final (no necesita `packages/video` en este punto — es un `<video>` normal contra el asset ya renderizado).

## Spec pendiente de escribir

El detalle completo de UI (componentes, wireframes, criterios de aceptación por pantalla) todavía no tiene su propia spec — se escribe como `003-dashboard-ui.md` cuando se llegue a este punto, siguiendo el mismo formato que 001/002.
