# Roadmap — Dashboard (front)

Documento de secuenciación puramente del front. Ver `README.md` de esta carpeta para qué queda afuera (eso vive en los docs de raíz del repo o en `frontend-notes.md`). No agrega alcance: cada fase sale del plan F1-F4 de `../../../docs/product/003-dashboard-ui.md` ("Plan de implementación") y cada ítem cita su AC 3.x, API-n o decisión (D-n) de esa spec. El detalle ítem por ítem vive en `tasks.md` de esta carpeta.

Última revisión: 2026-09-25, tercera pasada (spec 003: pregunta 7 cerrada con D16 — showcase con interfaz en español bajo `/[locale]`, `es` único valor, i18n completo como nice-to-have —, AC 3.80 nuevo, AC 3.79 partido en (a)/(b)/(c), dos layouts raíz; spec 004: preguntas A y B resueltas, API-17 ya no depende de decisiones del usuario). Segunda pasada del mismo día: spec 003 ajustada por la spec 004 (API-7a y API-17 bloqueantes de F2, API-18, AC 3.78/3.79, selector y distintivos de idioma, 6 motivos de `REQUIRES_HUMAN_REVIEW`). Revisión previa: 2026-09-25 (spec 003 escrita y revisada por `architect`; auth resuelta por ADR 0001; fases reescritas según F1-F4).

## Objetivo

Un dashboard Next.js 16 (`decision-log.md` #1) con dos superficies en la misma app (spec 003, "Contexto" y D9):

1. **Panel de curación privado** bajo `/studio` (un solo curador, sesión por cookie): crear episodios eligiendo el idioma del debate (D15, spec 004), seguirlos en vivo, enterarse por el inbox de cuándo requieren intervención, resolverla (curaduría en `PENDING_REVIEW`, los 6 motivos de `REQUIRES_HUMAN_REVIEW`, regenerar audio) y decidir qué se publica. La interfaz del panel es en español (D8); el idioma del contenido de cada debate es el del episodio.
2. **Showcase público** bajo un segmento de idioma de interfaz (`/[locale]`, D9 y D16): en F4, solo `/es` (lista) y `/es/e/[id]` (detalle), con la interfaz en español; `/` redirige a `/es` (307). Muestra episodios **publicados** (D10) en estado `READY_FOR_RENDER`/`RENDERING`/`COMPLETED`, reproducidos en vivo con `@remotion/player` contra el manifest (D2), con transcripción, veredicto e idioma del debate. El idioma de la interfaz (`locale`) es independiente del idioma de cada debate. No espera a Feature 9: el `.mp4` reemplaza al player cuando exista.

Stack fijo (D4): Tailwind + shadcn/ui + TanStack Query + `openapi-typescript`/`openapi-fetch`. Tipos de la API solo desde `openapi.json` (D5); `DebateLanguage` incluido, nunca como lista escrita a mano. Los `locale` de interfaz del showcase son una lista propia del dashboard y no se derivan de `DebateLanguage` (Restricciones técnicas, "Tipos generados").

## Estado de los bloqueantes previos

Ya no hay bloqueantes de infraestructura: las specs 001 (`openapi.json`) y 002 (monorepo, scaffold de `apps/dashboard`, `@ai-trend-debates/contracts`, `@ai-trend-debates/video`) están implementadas (`roadmap.md` de la raíz, Fase 5; `tasks.md` de la raíz §10-11).

Lo que sí condiciona cada fase son las **dependencias de backend API-1..API-18** de la spec 003 ("Cambios requeridos en la API"), trackeadas en `roadmap.md` de la raíz (Fase 6) y `tasks.md` de la raíz (§12). **API-17 (idioma del debate) la entrega la spec 004** (`roadmap.md` de la raíz, Fase 7; `tasks.md` de la raíz §13). Sus preguntas abiertas ya están resueltas, así que API-17 no depende de ninguna decisión del usuario: es trabajo de backend en serie (voces `EN`/`PT`, migración, TTS, API). Cada fase de abajo lista las que necesita.

## Autenticación (resuelta)

El gap de `decision-log.md` #1 queda cerrado por **ADR 0001** (`../../../docs/adr/0001-auth-sesion-nest-mismo-origen.md`) y D1/D11 de la spec:

- Nest emite y valida la sesión (`POST /auth/login`, `POST /auth/logout`, `GET /auth/session`); `SessionGuard` global niega por defecto, excepciones con `@Public()`.
- Next es el único origen público: rewrites `/api/:path*` y `/audio-files/:path*` hacia `API_INTERNAL_URL`. Sin `app/api` en el dashboard (prohibido por el ADR).
- `src/proxy.ts` (Next 16) solo hace el chequeo optimista de la cookie en `/studio/*`; la autorización real es el `401` de Nest.
- El panel pide datos del lado del cliente; el servidor de Next nunca reenvía cookies.

## Fases

### Fase 1 (F1) — Base: auth, origen único, cliente tipado, layouts

Objetivo: que exista la app real con login, rutas protegidas, un cliente tipado generado desde `openapi.json` y los dos layouts raíz (panel y showcase), sin pantallas de negocio todavía.

- Dependencias de backend: **API-8** (bloqueante: auth según ADR 0001, sin `enableCors()`). Recomendadas en paralelo, para no frenar F2: API-1, API-5, API-7a, API-10, API-12, API-13 y la parte de backend de la spec 004 (API-17).
- Dependencias de workspace: `check-boundaries` extendido a `apps/dashboard`; `dev.dependsOn: ["^build"]` en el `turbo.json` raíz (ambos trackeados en la raíz, §12).
- **Layouts raíz separados** (Restricciones técnicas, "Layouts raíz separados para panel y showcase"; AC 3.79 a; D16): hoy `src/app/layout.tsx` es el único layout raíz y declara `lang="en"` (línea 23). Se reemplaza por dos layouts raíz, sin `app/layout.tsx` compartido: `app/(panel)/layout.tsx` con `<html lang="es">` (contiene `login/` y `studio/`; las URLs no cambian) y `app/[locale]/layout.tsx` con `<html lang={locale}>`, con `es` como único valor válido. `/` redirige a `/es` (307). Costo aceptado: navegar entre panel y showcase hace una recarga completa.
- **Spike**: `app/global-not-found.js` es experimental en Next 16.3.6; verificar el flag antes de usarlo o resolver la 404 con `not-found` dentro de cada layout raíz.
- [ ] Stack de D4 instalado; `apps/dashboard/turbo.json` con `generate:api` (Restricciones técnicas, "Turborepo y tipos")
- [ ] Rewrites + `experimental.proxyTimeout` en `next.config` (ADR 0001 punto 3; Restricciones técnicas, "Rewrites y SSE")
- [ ] Cliente tipado con `openapi-fetch` (D11) y manejo global del `401` (AC 3.7)
- [ ] `src/proxy.ts` + `/login` + logout (AC 3.1-3.9)
- [ ] Separar los layouts raíz: `(panel)` con `lang="es"` y `[locale]` con `lang={locale}` (solo `es`), `/` → 307 a `/es`, 404 global (AC 3.79 a; D16)
- [ ] Layout del panel con navegación, incluido el enlace al showcase en `/es`, y layout del showcase sin controles del panel (AC 3.6, AC 3.15)

**Criterio de completitud** (spec, F1): `pnpm build` en verde; AC 3.1-3.9, AC 3.15 y AC 3.79 (a) cumplidos; `/` redirige a `/es` y `/en` responde 404; un cambio en `openapi.json` que rompa un tipo usado hace fallar el build del dashboard; un import prohibido hace fallar `check-boundaries`.

### Fase 2 (F2) — Panel de curación (privado)

Objetivo: operar el pipeline completo desde la UI, sin curl: inbox, lista (con idioma y distintivo "Publicado"), crear (con selector de idioma), detalle con vista en vivo, curaduría y resolución de los **6 motivos** de `REQUIRES_HUMAN_REVIEW` (`USAGE_LIMIT_EXCEEDED`, `INSUFFICIENT_EVIDENCE`, `MAX_REVISIONS_EXCEEDED`, `VALIDATION_INCONSISTENCY`, `PROVIDER_QUOTA_EXCEEDED`, `VOICE_NOT_CONFIGURED`).

- Dependencias de backend bloqueantes: **API-1** (tópico, `createdAt`, `language` y participantes en el detalle; `language` en el listado), **API-5** (schemas de notificaciones), **API-7a** (`publishedAt` en detalle y listado, para el distintivo "Publicado"), **API-12** (`pipelineActive`), **API-13** (`heartbeat` SSE + `Cache-Control: no-transform`), **API-17** (idioma del debate: `language` en `createEpisode`, `409 VOICE_NOT_CONFIGURED`, motivo `VOICE_NOT_CONFIGURED`, `meta.language`; lo entrega la spec 004).
- Recomendadas: **API-10** (bodies/errores de acciones en `openapi.json`, "recomendado antes de F2"), **API-10b** (mensajes de AC 3.50), **API-14** (`argumentId` ajeno → `404`), **API-16** (`maxTtsSegments` en `resume`; sin ella, AC 3.51 cae al modo "solo Rechazar" para TTS). No bloqueante: **API-18** (agentes sin voz; sin ella, el panel `VOICE_NOT_CONFIGURED` lista los participantes del episodio).
- Etiquetas de idioma (spec, "Mapeo de estados a UI"): `ES` → "Español", `EN` → "English", `PT` → "Português"; en el distintivo compacto, el código con el nombre completo accesible.
- [ ] Inbox de notificaciones en el header (sección 2, AC 3.10-3.14)
- [ ] Lista agrupada y filtrable, con distintivo de idioma y "Publicado" (sección 3, AC 3.16-3.21)
- [ ] Crear episodio con selector de idioma y manejo de `409 VOICE_NOT_CONFIGURED` (sección 4, AC 3.22-3.25, AC 3.78)
- [ ] Detalle + vista en vivo (SSE/polling/episodio trabado), con distintivo de idioma en la cabecera (sección 5, AC 3.26-3.41)
- [ ] Argumentos, veredicto y feed marcados con el idioma del episodio (AC 3.79 b; requiere API-17)
- [ ] Curaduría en `PENDING_REVIEW` (sección 6, AC 3.42-3.50)
- [ ] Resolución de los 6 motivos (sección 7, AC 3.51-3.55; D13 para `VALIDATION_INCONSISTENCY`)
- [ ] Spike de compresión de SSE a través del rewrite (Restricciones técnicas)

**Criterio de completitud** (spec, F2): AC 3.10-3.55, AC 3.78 y AC 3.79 (b) cumplidos; se crea un episodio desde la UI en cada idioma con voces configuradas y se sigue en vivo hasta `PENDING_REVIEW` sin recargar y sin cortes de conexión; crear en un idioma sin voces muestra el mensaje de AC 3.78; se fuerza cada motivo de `REQUIRES_HUMAN_REVIEW` en local (límites bajos, sin claves, quitando una voz del seed, etc.) y se resuelve desde la UI; el distintivo "Publicado" se verifica con `publishedAt` puesto a mano.

### Fase 3 (F3) — Preview con audio y regenerar audio

Objetivo: que el curador vea y escuche el episodio en el panel (`/studio/episodes/[id]/preview`) con `@remotion/player` contra `GET /episodes/:id/manifest`, y pueda regenerar el audio de un segmento.

- Dependencias de workspace (trackeadas en la raíz, §12): **`packages/video` como librería** (Restricciones técnicas, puntos 1-4: `src/studio.ts`, `index.ts` sin efectos, `peerDependencies`, `@remotion/player` movido a `apps/dashboard`) con **audio real en la composición** (pendiente heredado de la spec 002), y **catálogo de pnpm** con React `19.3.0` y Remotion `4.0.528`.
- Dependencias de backend: ninguna bloqueante. Recomendada: **API-10b** (mensajes específicos de AC 3.62).
- [ ] Player embebido contra el manifest con audio (AC 3.56, AC 3.57, AC 3.63)
- [ ] Estado vacío `MANIFEST_NOT_READY` (AC 3.58)
- [ ] Renovación de URLs de audio vencidas (AC 3.59)
- [ ] Regenerar audio por segmento (AC 3.60-3.62)

**Criterio de completitud** (spec, F3): AC 3.56-3.63 cumplidos; `pnpm why react` muestra una sola versión; `pnpm video:studio` sigue funcionando; approve lleva, sin recargar, a un preview con sonido.

### Fase 4 (F4) — Publicación y showcase público (interfaz en español)

Objetivo: publicar/despublicar desde el preview (D10) y exponer el showcase público en `/es` y `/es/e/[id]` con la interfaz en español (D16), sobre episodios publicados en `SHOWCASE_STATUSES`, reproducidos con `@remotion/player` contra el manifest (D2), con el idioma de cada debate. No usa `.mp4` (Feature 9 no existe).

- Dependencias de backend bloqueantes: **API-7** (`publish`/`unpublish` sobre el `publishedAt` de API-7a, `showcase.controller` con `GET /showcase/episodes` —con `language`— y `GET /showcase/episodes/:id`) y **API-8 en producción**, con el TTL de audio de 3600 s (D12). Ajuste de `coding-rules.md` §1 (varios controllers por módulo).
- Preguntas abiertas a resolver antes de arrancar: 4 (origen `HUMAN_EDITED` en el showcase) y 10 (`/docs` en producción).
- Fuera de F4: la interfaz en `/en` y `/pt` con selector (i18n completo del showcase, nice-to-have, D16; ver "Backlog").
- [ ] Publicar/despublicar en el preview, con enlace público a `/es/e/[id]` (AC 3.64, AC 3.65)
- [ ] `/[locale]` — lista del showcase con distintivo de idioma del debate (AC 3.66, AC 3.71)
- [ ] `/[locale]/e/[id]` — player + transcripción + veredicto + distintivo de idioma desde `manifest.meta.language` (AC 3.67, AC 3.68, AC 3.70)
- [ ] `<html lang>` según el `locale` de la ruta y transcripción/veredicto marcados con el idioma del debate (AC 3.79 c)
- [ ] Rutas preparadas para i18n: interfaz en español, `/` → 307 a `/es`, cualquier otro `locale` → 404, enlaces internos siempre con el segmento de idioma (AC 3.80)
- [ ] Caché y renovación de URLs acotadas al TTL (AC 3.72); ningún dato interno expuesto (AC 3.69)

**Criterio de completitud** (spec, F4): AC 3.64-3.72, AC 3.79 (c) y AC 3.80 cumplidos; sin sesión, el showcase funciona y ninguna respuesta de red contiene datos internos; con curl sin sesión, las acciones devuelven `401`; un episodio sin publicar o despublicado responde `404` en `/showcase/episodes/:id`.

### Transversales (todas las fases)

AC 3.73-3.77 (estados de carga/vacío/error, fechas en zona del navegador, confirmación en acciones destructivas o que consumen presupuesto, 1280 px panel / 360 px showcase, teclado y foco). Se verifican al cerrar cada fase sobre las pantallas de esa fase, no como fase aparte.

**Criterio de aceptación de la spec completa**: el de la sección "Criterio de aceptación" de la spec 003 (recorrido completo login → crear en un idioma distinto de español → publicar → despublicar, los 6 motivos resueltos al menos una vez desde la UI, AC 3.1-3.80 verificados).

## Backlog (nice-to-have, no se implementa sin pedirlo)

- **i18n completo de la interfaz del showcase** (spec 003, D16 y "MVP vs. nice-to-have"): interfaz también en `/en` y `/pt`, selector de idioma de interfaz, textos traducidos, `/` redirigiendo según el idioma del navegador y enlaces alternativos entre idiomas para buscadores. Objetivo fijado por el usuario, fuera de F4. Las rutas de F4 ya lo dejan preparado: ninguna URL existente cambia.

## Spec

La spec de UI está escrita: `../../../docs/product/003-dashboard-ui.md` (especificada y revisada por `architect`, 2026-09-25, ajustada el mismo día por la spec 004 y por el cierre de la pregunta 7). Contiene mapa de rutas, mapeo de los 14 estados a UI y etiquetas de idioma, user stories y AC 3.1-3.80 por pantalla, edge cases, MVP vs. nice-to-have, dependencias de backend (API-1..API-18, con API-7a), restricciones técnicas (incluidos los dos layouts raíz) y el plan F1-F4 que sigue este roadmap. La topología de auth está en ADR 0001; las voces por agente e idioma, en ADR 0002. El comportamiento del pipeline según el idioma es de la spec 004 (`../../../docs/product/004-debate-language.md`); el dashboard solo lo consume (AC 4.20-4.23 = AC 3.22, 3.78, 3.17/3.26, 3.66/3.67).

## Preguntas abiertas (no se infieren; las resuelve el usuario)

- **Pregunta 5 de la spec** (antes de F2) — veredicto tras editar/regenerar: ¿alcanza con un aviso en la UI?
- **Pregunta 8 de la spec** (F2, barato de cambiar) — intervalos de polling propuestos: 30 s inbox, 10 s detalle.
- **Preguntas 4 y 10 de la spec** (antes de F4) — origen `HUMAN_EDITED` en el showcase, `/docs` en producción.

**Resueltas**:
- `publishedAt` en F2 → **API-7a** (decisión del usuario, spec 003 D10): la columna y su exposición en detalle y listado se adelantan a F2; `publish`/`unpublish` y `/showcase` siguen en F4 (API-7).
- Pregunta 7 de la spec 003, idioma de la interfaz del showcase → **D16** (decisión del usuario): español en F4 bajo `/[locale]` con `es` como único valor; i18n completo como nice-to-have (ver "Backlog").
- Preguntas A y B de la spec 004 → resueltas por el usuario (voces por idioma y voz de los episodios `ES` existentes). API-17 ya no depende de decisiones pendientes.
