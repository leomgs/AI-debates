# Roadmap — Dashboard (front)

Documento de secuenciación puramente del front. Ver `README.md` de esta carpeta para qué queda afuera (eso vive en los docs de raíz del repo o en `frontend-notes.md`). No agrega alcance: cada fase sale del plan F1-F4 de `../../../docs/product/003-dashboard-ui.md` ("Plan de implementación") y cada ítem cita su AC 3.x, API-n o decisión (D-n) de esa spec. El detalle ítem por ítem vive en `tasks.md` de esta carpeta.

Última revisión: 2026-09-25 (spec 003 escrita y revisada por `architect`; auth resuelta por ADR 0001; fases reescritas según F1-F4).

## Objetivo

Un dashboard Next.js 16 (`decision-log.md` #1) con dos superficies en la misma app (spec 003, "Contexto" y D9):

1. **Panel de curación privado** bajo `/studio` (un solo curador, sesión por cookie): crear episodios, seguirlos en vivo, enterarse por el inbox de cuándo requieren intervención, resolverla (curaduría en `PENDING_REVIEW`, los 5 motivos de `REQUIRES_HUMAN_REVIEW`, regenerar audio) y decidir qué se publica.
2. **Showcase público** en la raíz (`/`, `/e/[id]`): episodios **publicados** (D10) en estado `READY_FOR_RENDER`/`RENDERING`/`COMPLETED`, reproducidos en vivo con `@remotion/player` contra el manifest (D2), con transcripción y veredicto. No espera a Feature 9: el `.mp4` reemplaza al player cuando exista.

Stack fijo (D4): Tailwind + shadcn/ui + TanStack Query + `openapi-typescript`/`openapi-fetch`. Tipos de la API solo desde `openapi.json` (D5).

## Estado de los bloqueantes previos

Ya no hay bloqueantes de infraestructura: las specs 001 (`openapi.json`) y 002 (monorepo, scaffold de `apps/dashboard`, `@ai-trend-debates/contracts`, `@ai-trend-debates/video`) están implementadas (`roadmap.md` de la raíz, Fase 5; `tasks.md` de la raíz §10-11).

Lo que sí condiciona cada fase son las **dependencias de backend API-1..API-16** de la spec 003 ("Cambios requeridos en la API"), trackeadas en `roadmap.md` de la raíz (Fase 6) y `tasks.md` de la raíz (§12). Cada fase de abajo lista las que necesita.

## Autenticación (resuelta)

El gap de `decision-log.md` #1 queda cerrado por **ADR 0001** (`../../../docs/adr/0001-auth-sesion-nest-mismo-origen.md`) y D1/D11 de la spec:

- Nest emite y valida la sesión (`POST /auth/login`, `POST /auth/logout`, `GET /auth/session`); `SessionGuard` global niega por defecto, excepciones con `@Public()`.
- Next es el único origen público: rewrites `/api/:path*` y `/audio-files/:path*` hacia `API_INTERNAL_URL`. Sin `app/api` en el dashboard (prohibido por el ADR).
- `src/proxy.ts` (Next 16) solo hace el chequeo optimista de la cookie en `/studio/*`; la autorización real es el `401` de Nest.
- El panel pide datos del lado del cliente; el servidor de Next nunca reenvía cookies.

## Fases

### Fase 1 (F1) — Base: auth, origen único, cliente tipado, layout

Objetivo: que exista la app real con login, rutas protegidas, un cliente tipado generado desde `openapi.json` y los layouts de ambas superficies, sin pantallas de negocio todavía.

- Dependencias de backend: **API-8** (bloqueante: auth según ADR 0001, sin `enableCors()`). Recomendadas en paralelo, para no frenar F2: API-1, API-5, API-10, API-12, API-13.
- Dependencias de workspace: `check-boundaries` extendido a `apps/dashboard`; `dev.dependsOn: ["^build"]` en el `turbo.json` raíz (ambos trackeados en la raíz, §12).
- [ ] Stack de D4 instalado; `apps/dashboard/turbo.json` con `generate:api` (Restricciones técnicas, "Turborepo y tipos")
- [ ] Rewrites + `experimental.proxyTimeout` en `next.config` (ADR 0001 punto 3; Restricciones técnicas, "Rewrites y SSE")
- [ ] Cliente tipado con `openapi-fetch` (D11) y manejo global del `401` (AC 3.7)
- [ ] `src/proxy.ts` + `/login` + logout (AC 3.1-3.9)
- [ ] Layout del panel con navegación y layout del showcase (AC 3.6, AC 3.15)

**Criterio de completitud** (spec, F1): `pnpm build` en verde; AC 3.1-3.9 y AC 3.15 cumplidos; un cambio en `openapi.json` que rompa un tipo usado hace fallar el build del dashboard; un import prohibido hace fallar `check-boundaries`.

### Fase 2 (F2) — Panel de curación (privado)

Objetivo: operar el pipeline completo desde la UI, sin curl: inbox, lista, crear, detalle con vista en vivo, curaduría y resolución de los **5 motivos** de `REQUIRES_HUMAN_REVIEW` (`USAGE_LIMIT_EXCEEDED`, `INSUFFICIENT_EVIDENCE`, `MAX_REVISIONS_EXCEEDED`, `VALIDATION_INCONSISTENCY`, `PROVIDER_QUOTA_EXCEEDED`).

- Dependencias de backend bloqueantes: **API-1** (tópico, `createdAt`, participantes en el detalle), **API-5** (schemas de notificaciones), **API-12** (`pipelineActive`), **API-13** (`heartbeat` SSE + `Cache-Control: no-transform`).
- Recomendadas: **API-10** (bodies/errores de acciones en `openapi.json`, "recomendado antes de F2"), **API-10b** (mensajes de AC 3.50), **API-14** (`argumentId` ajeno → `404`), **API-16** (`maxTtsSegments` en `resume`; sin ella, AC 3.51 cae al modo "solo Rechazar" para TTS).
- El distintivo "Publicado" de AC 3.17/3.26 necesita `publishedAt` (parte de **API-7**); ver "Preguntas abiertas" de este archivo.
- [ ] Inbox de notificaciones en el header (sección 2, AC 3.10-3.14)
- [ ] Lista agrupada y filtrable (sección 3, AC 3.16-3.21)
- [ ] Crear episodio (sección 4, AC 3.22-3.25)
- [ ] Detalle + vista en vivo (SSE/polling/episodio trabado) (sección 5, AC 3.26-3.41)
- [ ] Curaduría en `PENDING_REVIEW` (sección 6, AC 3.42-3.50)
- [ ] Resolución de los 5 motivos (sección 7, AC 3.51-3.55; D13 para `VALIDATION_INCONSISTENCY`)
- [ ] Spike de compresión de SSE a través del rewrite (Restricciones técnicas)

**Criterio de completitud** (spec, F2): AC 3.10-3.55 cumplidos; se crea un episodio desde la UI y se sigue en vivo hasta `PENDING_REVIEW` sin recargar y sin cortes de conexión; se fuerza cada motivo de `REQUIRES_HUMAN_REVIEW` en local (límites bajos, sin claves, etc.) y se resuelve desde la UI.

### Fase 3 (F3) — Preview con audio y regenerar audio

Objetivo: que el curador vea y escuche el episodio en el panel (`/studio/episodes/[id]/preview`) con `@remotion/player` contra `GET /episodes/:id/manifest`, y pueda regenerar el audio de un segmento.

- Dependencias de workspace (trackeadas en la raíz, §12): **`packages/video` como librería** (Restricciones técnicas, puntos 1-4: `src/studio.ts`, `index.ts` sin efectos, `peerDependencies`, `@remotion/player` movido a `apps/dashboard`) con **audio real en la composición** (pendiente heredado de la spec 002), y **catálogo de pnpm** con React `19.3.0` y Remotion `4.0.528`.
- Dependencias de backend: ninguna bloqueante. Recomendada: **API-10b** (mensajes específicos de AC 3.62).
- [ ] Player embebido contra el manifest con audio (AC 3.56, AC 3.57, AC 3.63)
- [ ] Estado vacío `MANIFEST_NOT_READY` (AC 3.58)
- [ ] Renovación de URLs de audio vencidas (AC 3.59)
- [ ] Regenerar audio por segmento (AC 3.60-3.62)

**Criterio de completitud** (spec, F3): AC 3.56-3.63 cumplidos; `pnpm why react` muestra una sola versión; `pnpm video:studio` sigue funcionando; approve lleva, sin recargar, a un preview con sonido.

### Fase 4 (F4) — Publicación y showcase público

Objetivo: publicar/despublicar desde el preview (D10) y exponer el showcase público en `/` y `/e/[id]` sobre episodios publicados en `SHOWCASE_STATUSES`, reproducidos con `@remotion/player` contra el manifest (D2). No usa `.mp4` (Feature 9 no existe).

- Dependencias de backend bloqueantes: **API-7** (`publishedAt`, `publish`/`unpublish`, `showcase.controller` con `GET /showcase/episodes` y `GET /showcase/episodes/:id`) y **API-8 en producción**, con el TTL de audio de 3600 s (D12). Ajuste de `coding-rules.md` §1 (varios controllers por módulo).
- Preguntas abiertas a resolver antes de arrancar: 4 (origen `HUMAN_EDITED` en el showcase), 7 (idioma del showcase), 10 (`/docs` en producción).
- [ ] Publicar/despublicar en el preview (AC 3.64, AC 3.65)
- [ ] `/` — lista del showcase (AC 3.66, AC 3.71)
- [ ] `/e/[id]` — player + transcripción + veredicto (AC 3.67, AC 3.68, AC 3.70)
- [ ] Caché y renovación de URLs acotadas al TTL (AC 3.72); ningún dato interno expuesto (AC 3.69)

**Criterio de completitud** (spec, F4): AC 3.64-3.72 cumplidos; sin sesión, el showcase funciona y ninguna respuesta de red contiene datos internos; con curl sin sesión, las acciones devuelven `401`; un episodio sin publicar o despublicado responde `404` en `/showcase/episodes/:id`.

### Transversales (todas las fases)

AC 3.73-3.77 (estados de carga/vacío/error, fechas en zona del navegador, confirmación en acciones destructivas o que consumen presupuesto, 1280 px panel / 360 px showcase, teclado y foco). Se verifican al cerrar cada fase sobre las pantallas de esa fase, no como fase aparte.

**Criterio de aceptación de la spec completa**: el de la sección "Criterio de aceptación" de la spec 003 (recorrido completo login → publicar → despublicar, los 5 motivos resueltos al menos una vez desde la UI, AC 3.1-3.77 verificados).

## Spec

La spec de UI está escrita: `../../../docs/product/003-dashboard-ui.md` (especificada y revisada por `architect`, 2026-09-25). Contiene mapa de rutas, mapeo de los 14 estados a UI, user stories y AC 3.1-3.77 por pantalla, edge cases, MVP vs. nice-to-have, dependencias de backend (API-1..API-16), restricciones técnicas y el plan F1-F4 que sigue este roadmap. La topología de auth está en ADR 0001.

## Preguntas abiertas (no se infieren; las resuelve el usuario)

- **Pregunta 5 de la spec** (antes de F2) — veredicto tras editar/regenerar: ¿alcanza con un aviso en la UI?
- **Pregunta 8 de la spec** (F2, barato de cambiar) — intervalos de polling propuestos: 30 s inbox, 10 s detalle.
- **Preguntas 4, 7 y 10 de la spec** (antes de F4) — origen `HUMAN_EDITED` en el showcase, idioma del showcase, `/docs` en producción.
- **`publishedAt` en F2** (detectado al planificar, a confirmar con `architect`/usuario): AC 3.17 y AC 3.26 (dentro del criterio de F2) muestran "Publicado", que depende de `publishedAt` (API-7), pero la spec no lista API-7 entre los requisitos de F2. Opciones: adelantar solo la parte `publishedAt` de API-7 antes de F2, o aceptar que el distintivo se completa en F4.
