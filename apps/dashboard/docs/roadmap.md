# Roadmap — Dashboard (front)

Documento de secuenciación puramente del front. Ver `README.md` de esta carpeta para qué queda afuera (eso vive en los docs de raíz del repo o en `frontend-notes.md`). No agrega alcance: cada fase sale del plan F1-F4 de `../../../docs/product/003-dashboard-ui.md` ("Plan de implementación") y cada ítem cita su AC 3.x, API-n o decisión (D-n) de esa spec. El detalle ítem por ítem vive en `tasks.md` de esta carpeta.

Última revisión: 2026-09-26, quinta pasada (F1 implementada y mergeada a `master` con fast-forward desde `feat/dashboard-f1`; checkboxes de la Fase 1 sincronizados con `tasks.md` §1, con las verificaciones en navegador pendientes y la 404 del showcase diferida a F4; la Fase 2 suma el estado de sus dependencias de backend y qué se puede adelantar antes de API-17). Cuarta pasada, 2026-09-25 (spec 003 sin preguntas abiertas: D17 veredicto desactualizado + "Volver a juzgar" con API-19 bloqueante de F2, D18 sin origen de ediciones en el showcase, D19 intervalos de polling centralizados, D20 `/docs` solo fuera de producción; AC 3.81-3.86; rango AC 3.1-3.86). Tercera pasada del mismo día: pregunta 7 cerrada con D16 (showcase bajo `/[locale]`, `es` único valor), AC 3.80, AC 3.79 partido en (a)/(b)/(c), dos layouts raíz; preguntas A y B de la spec 004 resueltas. Segunda pasada: spec 003 ajustada por la spec 004 (API-7a y API-17 bloqueantes de F2, API-18, AC 3.78/3.79, selector y distintivos de idioma, 6 motivos). Revisión previa: 2026-09-25 (spec 003 escrita y revisada por `architect`; auth resuelta por ADR 0001; fases reescritas según F1-F4).

## Objetivo

Un dashboard Next.js 16 (`decision-log.md` #1) con dos superficies en la misma app (spec 003, "Contexto" y D9):

1. **Panel de curación privado** bajo `/studio` (un solo curador, sesión por cookie): crear episodios eligiendo el idioma del debate (D15, spec 004), seguirlos en vivo, enterarse por el inbox de cuándo requieren intervención, resolverla (curaduría en `PENDING_REVIEW` con "Volver a juzgar" si el veredicto quedó desactualizado, los 6 motivos de `REQUIRES_HUMAN_REVIEW`, regenerar audio) y decidir qué se publica. La interfaz del panel es en español (D8); el idioma del contenido de cada debate es el del episodio.
2. **Showcase público** bajo un segmento de idioma de interfaz (`/[locale]`, D9 y D16): en F4, solo `/es` (lista) y `/es/e/[id]` (detalle), con la interfaz en español; `/` redirige a `/es` (307). Muestra episodios **publicados** (D10) en estado `READY_FOR_RENDER`/`RENDERING`/`COMPLETED`, reproducidos en vivo con `@remotion/player` contra el manifest (D2), con transcripción, veredicto e idioma del debate, sin mostrar qué partes editó el curador (D18). El idioma de la interfaz (`locale`) es independiente del idioma de cada debate. No espera a Feature 9: el `.mp4` reemplaza al player cuando exista.

Stack fijo (D4): Tailwind + shadcn/ui + TanStack Query + `openapi-typescript`/`openapi-fetch`. Tipos de la API solo desde `openapi.json` (D5); `DebateLanguage` incluido, nunca como lista escrita a mano. Los `locale` de interfaz del showcase son una lista propia del dashboard y no se derivan de `DebateLanguage` (Restricciones técnicas, "Tipos generados").

## Estado de los bloqueantes previos

Ya no hay bloqueantes de infraestructura: las specs 001 (`openapi.json`) y 002 (monorepo, scaffold de `apps/dashboard`, `@ai-trend-debates/contracts`, `@ai-trend-debates/video`) están implementadas (`roadmap.md` de la raíz, Fase 5; `tasks.md` de la raíz §10-11). La F1 está mergeada en `master` (2026-09-26).

Lo que sí condiciona cada fase son las **dependencias de backend API-1..API-19** de la spec 003 ("Cambios requeridos en la API"), trackeadas en `roadmap.md` de la raíz (Fase 6) y `tasks.md` de la raíz (§12). **API-17 (idioma del debate) la entrega la spec 004** (`roadmap.md` de la raíz, Fase 7; `tasks.md` de la raíz §13); sus preguntas abiertas ya están resueltas, así que es trabajo de backend en serie (voces `EN`/`PT`, migración, TTS, API). API-19 (`regenerate-verdict`) ya está hecha, sobre API-10b y la extracción de `EpisodeContextService` (paso 5a de la 004). Ninguna dependencia espera decisiones del usuario. Cada fase de abajo lista las que necesita; el estado actual de las de F2 está en la Fase 2.

## Autenticación (resuelta)

El gap de `decision-log.md` #1 queda cerrado por **ADR 0001** (`../../../docs/adr/0001-auth-sesion-nest-mismo-origen.md`) y D1/D11 de la spec:

- Nest emite y valida la sesión (`POST /auth/login`, `POST /auth/logout`, `GET /auth/session`); `SessionGuard` global niega por defecto, excepciones con `@Public()`.
- Next es el único origen público: rewrites `/api/:path*` y `/audio-files/:path*` hacia `API_INTERNAL_URL`. Sin `app/api` en el dashboard (prohibido por el ADR).
- `src/proxy.ts` (Next 16) hace el chequeo optimista de la cookie en `/studio/*`; la autorización real es el `401` de Nest. Según la aclaración del ADR 0001 hecha en el review de F1 ("Aclaración: alcance de `src/proxy.ts`"), además puede normalizar y rutear URLs sin datos ni secretos (hoy, la canonicalización de mayúsculas).
- El panel pide datos del lado del cliente; el servidor de Next nunca reenvía cookies.
- `/docs` (Swagger) solo existe fuera de producción (D20, dentro de API-8); no es una ruta del dashboard.

## Fases

### Fase 1 (F1) — Base: auth, origen único, cliente tipado, layouts — IMPLEMENTADA Y MERGEADA (2026-09-26), con verificaciones en navegador pendientes

Objetivo: que exista la app real con login, rutas protegidas, un cliente tipado generado desde `openapi.json` y los dos layouts raíz (panel y showcase), sin pantallas de negocio todavía.

**Estado**: mergeada con fast-forward a `master` el 2026-09-26 desde `feat/dashboard-f1` (`aa07477`), después de dos revisiones de `code-reviewer` y de una aclaración del ADR 0001 hecha por `architect` (alcance de `src/proxy.ts`). Detalle ítem por ítem en `tasks.md` §1; proceso y hallazgos en `decision-log.md` entrada 6. Convención de esta lista: `[x]` hecho y verificado; `[~]` implementado y verificado con curl o tests, pero falta la prueba a mano en un navegador; `[ ]` pendiente o diferido.

- Dependencias de backend: **API-8** (bloqueante: auth según ADR 0001, sin `enableCors()`, `/docs` solo fuera de producción), **hecha 2026-09-25**. De las recomendadas en paralelo (API-1, API-5, API-7a, API-10, API-10b, API-12, API-13, API-19 y la parte de backend de la spec 004, que entrega API-17), el estado actual está en la Fase 2.
- Dependencias de workspace: `check-boundaries` extendido a `apps/dashboard` y `dev.dependsOn: ["^build"]` en el `turbo.json` raíz, **hechas 2026-09-26** dentro de la rama de F1 (raíz, `tasks.md` §12.1).
- **`proxyTimeout` del rewrite**: tiene que superar el peor caso de una acción sincrónica, que es `regenerate-verdict` (API-19): hasta unos 90 s de espera del limitador de RPM más los reintentos. Además cubre el SSE junto con el `heartbeat` (API-13). Quedó en 10 minutos (`tasks.md` §1).
- **Layouts raíz separados** (Restricciones técnicas, "Layouts raíz separados para panel y showcase"; AC 3.79 a; D16): se eliminó `src/app/layout.tsx`, que era el único layout raíz y declaraba `lang="en"`. Quedaron dos layouts raíz, sin layout compartido: `app/(panel)/layout.tsx` con `<html lang="es">` (contiene `login/` y `studio/`; las URLs no cambian) y `app/[locale]/layout.tsx` con `<html lang={locale}>`, con `es` como único valor válido. `/` redirige a `/es` (307). Costo aceptado: navegar entre panel y showcase hace una recarga completa.
- **Spike de `global-not-found`**, resuelto: el flag `experimental.globalNotFound` existe en Next 16.3.6 y se usa (`app/global-not-found.tsx`, en español), más un `not-found.tsx` dentro de cada layout raíz (`decision-log.md` entrada 6).
- **Surgido del review** (fuera del plan original, sin alcance de producto nuevo): `proxy.ts` redirige con 308 cualquier path con mayúsculas a su versión en minúsculas, y el panel y el showcase son `force-dynamic`, para que `/ES` o `/Studio` no pisen el caché ISR ni salteen el chequeo de la cookie. Consecuencia: un `locale` inválido (`/en`, `/xx`) responde 404 con la página por defecto de Next, en inglés; el usuario lo aceptó explícitamente hasta la F4 (`decision-log.md` entrada 6, "Costo aceptado").
- [x] Stack de D4 instalado; `apps/dashboard/turbo.json` con `generate:api` (Restricciones técnicas, "Turborepo y tipos"). Se sumó Vitest para los tests unitarios del front
- [x] Rewrites + `experimental.proxyTimeout` por encima del peor caso de `regenerate-verdict` en `next.config` (ADR 0001 punto 3; Restricciones técnicas, "Rewrites y SSE"). Verificado con curl: `/api/*` y `/audio-files/*` llegan a Nest y no caen en `[locale]`
- [~] Cliente tipado con `openapi-fetch` (D11) y manejo global del `401` (AC 3.7). El cliente y el redirect a `/login?next=…&expired=1` están hechos y probados con tests de `QueryClient`; falta ver en un navegador el aviso de sesión vencida
- [~] `src/proxy.ts` + `/login` + logout (AC 3.1-3.9). Verificado con curl a través del rewrite: redirect a `/login?next=` y validación de `next` (AC 3.1), `401 INVALID_CREDENTIALS` (AC 3.2), `Max-Age` de 7 días en la cookie (AC 3.3), logout `204` (AC 3.4), `401 UNAUTHORIZED` en los endpoints no públicos (AC 3.5), `429` con `Retry-After` (AC 3.8), y la URL interna ausente del HTML y de los chunks (AC 3.9). Faltan las pruebas en navegador (ver "Pendiente para cerrar la F1")
- [x] Separar los layouts raíz: `(panel)` con `lang="es"` y `[locale]` con `lang={locale}` (solo `es`), `/` → 307 a `/es`, 404 global con `global-not-found` (AC 3.79 a; D16). Verificado con curl: `lang="es"` en `/login`, `/studio` y `/studio/new`; `/en`, `/pt` y `/xx` responden 404
- [ ] **Diferido a F4**: 404 del showcase en español y con `lang` en el HTML inicial (`tasks.md` §4, AC 3.68 y AC 3.80). Hoy el status es 404 correcto, pero un `locale` inválido muestra la 404 por defecto de Next en inglés, y un `notFound()` en `/es/e/[id]` sale sin `lang`. Aceptado por el usuario hasta F4; no bloquea el criterio de F1
- [x] Layout del panel con navegación, incluido el enlace al showcase en `/es`, y layout del showcase sin controles del panel (AC 3.6, AC 3.15). `/studio` y `/studio/new` son placeholders hasta F2

**Pendiente para cerrar la F1** (a mano, en un navegador real; lo hace el usuario; ver los `[~]` de `tasks.md` §1):
- [ ] `/login` de punta a punta, con vuelta a `next` (AC 3.1, AC 3.2, AC 3.8)
- [ ] "Cerrar sesión" desde el botón del panel (AC 3.4)
- [ ] Aviso de sesión vencida ante un `401` (AC 3.7)
- [ ] Persistencia de la sesión con recargas (AC 3.3)
- [ ] Pestaña de red: ninguna request sale hacia la URL interna de la API (AC 3.9)
- [ ] Teclado y foco en `/login` y en la navegación del panel (AC 3.77, transversal)

**Criterio de completitud** (spec, F1): `pnpm build` en verde; AC 3.1-3.9, AC 3.15 y AC 3.79 (a) cumplidos; `/` redirige a `/es` y `/en` responde 404; un cambio en `openapi.json` que rompa un tipo usado hace fallar el build del dashboard; un import prohibido hace fallar `check-boundaries`.

**Estado del criterio** (2026-09-26): `pnpm build` en verde; renombrar un valor usado de `openapi.json` rompe el build (`TS2353`); un import prohibido hace fallar `check-boundaries` y corta `pnpm build`; `/` → 307 a `/es` y `/en` → 404 (con la página por defecto de Next, ver el ítem diferido); AC 3.6, AC 3.15 y AC 3.79 (a) cumplidos. AC 3.1-3.9 están cumplidos en todo lo que se puede verificar con curl y tests; AC 3.3, AC 3.7, AC 3.9 y los flujos de interfaz de AC 3.1 y AC 3.4 esperan la prueba en navegador. La F1 queda cerrada en código y se da por completa cuando se tilde la lista "Pendiente para cerrar la F1".

### Fase 2 (F2) — Panel de curación (privado) — sin empezar

Objetivo: operar el pipeline completo desde la UI, sin curl: inbox, lista (con idioma y distintivo "Publicado"), crear (con selector de idioma), detalle con vista en vivo, curaduría (incluido "Volver a juzgar" ante un veredicto desactualizado, D17) y resolución de los **6 motivos** de `REQUIRES_HUMAN_REVIEW` (`USAGE_LIMIT_EXCEEDED`, `INSUFFICIENT_EVIDENCE`, `MAX_REVISIONS_EXCEEDED`, `VALIDATION_INCONSISTENCY`, `PROVIDER_QUOTA_EXCEEDED`, `VOICE_NOT_CONFIGURED`).

- Dependencias de backend bloqueantes: **API-1** (tópico, `createdAt`, `language` y participantes en el detalle; `language` en el listado), **API-5** (schemas de notificaciones), **API-7a** (`publishedAt` en detalle y listado, para el distintivo "Publicado"), **API-12** (`pipelineActive`), **API-13** (`heartbeat` SSE + `Cache-Control: no-transform`), **API-17** (idioma del debate: `language` en `createEpisode`, `409 VOICE_NOT_CONFIGURED`, motivo `VOICE_NOT_CONFIGURED`, `meta.language`; lo entrega la spec 004), **API-19** (`regenerate-verdict` y `debate.verdict.stale`; requiere API-10b en el backend).
- Recomendadas: **API-10** (bodies/errores de acciones en `openapi.json`, "recomendado antes de F2"), **API-10b** (mensajes de AC 3.50 y 3.85; además, prerrequisito de API-19), **API-14** (`argumentId` ajeno → `404`), **API-16** (`maxTtsSegments` en `resume`; sin ella, AC 3.51 cae al modo "solo Rechazar" para TTS). No bloqueante: **API-18** (agentes sin voz; sin ella, el panel `VOICE_NOT_CONFIGURED` lista los participantes del episodio).
- **Estado de esas dependencias en `master` (2026-09-26)**: hechas API-1 parte 1 (sin `language`), API-5, API-7a, API-12, API-13, API-19, API-10b y API-14 (raíz, `decision-log.md` entradas 34 y 35). **Falta lo bloqueante**: API-17 y la parte 2 de API-1 (`language`), que entrega la sección 13 de `tasks.md` de la raíz (pasos 1, 4, 6 y 7). Faltan también las recomendadas API-10, API-16 y la no bloqueante API-18 (esta última, después del paso 6 de la 004 y con el mecanismo definido por `architect`).
- Etiquetas de idioma (spec, "Mapeo de estados a UI"): `ES` → "Español", `EN` → "English", `PT` → "Português"; en el distintivo compacto, el código con el nombre completo accesible.
- Intervalos de polling (D19): 30 s el inbox, 10 s el detalle en fases sin SSE y la lista, en constantes centralizadas (AC 3.86).
- [ ] Constantes de polling centralizadas (AC 3.86; D19)
- [ ] Inbox de notificaciones en el header (sección 2, AC 3.10-3.14)
- [ ] Lista agrupada y filtrable, con distintivo de idioma y "Publicado" (sección 3, AC 3.16-3.21)
- [ ] Crear episodio con selector de idioma y manejo de `409 VOICE_NOT_CONFIGURED` (sección 4, AC 3.22-3.25, AC 3.78)
- [ ] Detalle + vista en vivo (SSE/polling/episodio trabado), con distintivo de idioma en la cabecera (sección 5, AC 3.26-3.41)
- [ ] Argumentos, veredicto y feed marcados con el idioma del episodio (AC 3.79 b; requiere API-17)
- [ ] Curaduría en `PENDING_REVIEW` (sección 6, AC 3.42-3.50)
- [ ] Veredicto desactualizado y "Volver a juzgar" (sección 6, AC 3.81-3.85; D17; requiere API-19)
- [ ] Resolución de los 6 motivos (sección 7, AC 3.51-3.55; D13 para `VALIDATION_INCONSISTENCY`)
- [ ] Spike de compresión de SSE a través del rewrite (Restricciones técnicas)

**Qué se puede adelantar antes de API-17** (sobre lo que ya está en `master`). Criterio: se adelanta solo lo que (1) usa datos y tipos que ya están en `openapi.json`, (2) no lee ni envía `language` ni depende de `VOICE_NOT_CONFIGURED`, y (3) no necesita los tipos de las acciones. Sin API-10, `runEpisodeAction` en `openapi.json` no tiene body ni respuesta tipados (`action` es un `string` libre y la respuesta `201` no tiene schema), así que cualquier pantalla que llame acciones tendría que escribir esos tipos a mano, y eso lo prohíbe D5.
- **Se puede ya**, en este orden (de lo que más destraba a lo que menos): constantes de polling (AC 3.86); spike de compresión de SSE a través del rewrite (de-riesga la vista en vivo); detalle sin el distintivo de idioma (AC 3.26 salvo idioma, AC 3.27-3.31, 3.40, 3.41; API-1 parte 1, API-7a, API-12) + vista en vivo completa (AC 3.32-3.39; API-12, API-13); aviso de veredicto desactualizado, que es solo lectura de `debate.verdict.stale` (AC 3.81; las acciones que lo provocan se disparan con curl mientras tanto); lista sin el distintivo de idioma (AC 3.16, AC 3.17 salvo idioma, AC 3.18-3.21; API-7a); inbox completo (AC 3.10-3.14; API-5).
- **Se puede en parte**: crear episodio solo con `topic` (AC 3.22 sin el selector, AC 3.23-3.25). `language` va a entrar como campo opcional con default `ES`, así que el retrabajo es chico, pero AC 3.22 queda incompleto hasta API-17. Opcional: sirve para crear desde la UI y seguir el episodio en vivo, aunque también se puede crear con curl.
- **Espera a API-10**: curaduría (AC 3.42-3.50), "Volver a juzgar" y la confirmación de "Aprobar" con veredicto desactualizado (AC 3.82-3.85) y resolución de motivos (AC 3.51-3.55).
- **Espera a API-17 y a la parte 2 de API-1**: mapeo de `DebateLanguage` a etiqueta y distintivo de idioma (lista, detalle), selector de idioma y `409 VOICE_NOT_CONFIGURED` (AC 3.22, AC 3.78), marca de idioma en argumentos, veredicto y feed (AC 3.79 b), panel `VOICE_NOT_CONFIGURED` (AC 3.51) y la verificación del criterio de F2 en cada idioma.

**Criterio de completitud** (spec, F2): AC 3.10-3.55, AC 3.78, AC 3.79 (b) y AC 3.81-3.86 cumplidos; se crea un episodio desde la UI en cada idioma con voces configuradas y se sigue en vivo hasta `PENDING_REVIEW` sin recargar y sin cortes de conexión; crear en un idioma sin voces muestra el mensaje de AC 3.78; editar un argumento hace aparecer el aviso de veredicto desactualizado, y "Volver a juzgar" lo hace desaparecer; se fuerza cada motivo de `REQUIRES_HUMAN_REVIEW` en local (límites bajos, sin claves, quitando una voz del seed, etc.) y se resuelve desde la UI; el distintivo "Publicado" se verifica con `publishedAt` puesto a mano.

### Fase 3 (F3) — Preview con audio y regenerar audio

Objetivo: que el curador vea y escuche el episodio en el panel (`/studio/episodes/[id]/preview`) con `@remotion/player` contra `GET /episodes/:id/manifest`, y pueda regenerar el audio de un segmento.

- Dependencias de workspace (trackeadas en la raíz, §12): **`packages/video` como librería** (Restricciones técnicas, puntos 1-4: `src/studio.ts`, `index.ts` sin efectos, `peerDependencies`, `@remotion/player` movido a `apps/dashboard`) con **audio real en la composición** (pendiente heredado de la spec 002), y **catálogo de pnpm** con React `19.3.0` y Remotion `4.0.528`.
- Dependencias de backend: ninguna bloqueante. Recomendada: **API-10b** (mensajes específicos de AC 3.62), ya hecha.
- [ ] Player embebido contra el manifest con audio (AC 3.56, AC 3.57, AC 3.63)
- [ ] Estado vacío `MANIFEST_NOT_READY` (AC 3.58)
- [ ] Renovación de URLs de audio vencidas (AC 3.59)
- [ ] Regenerar audio por segmento (AC 3.60-3.62)

**Criterio de completitud** (spec, F3): AC 3.56-3.63 cumplidos; `pnpm why react` muestra una sola versión; `pnpm video:studio` sigue funcionando; approve lleva, sin recargar, a un preview con sonido.

### Fase 4 (F4) — Publicación y showcase público (interfaz en español)

Objetivo: publicar/despublicar desde el preview (D10) y exponer el showcase público en `/es` y `/es/e/[id]` con la interfaz en español (D16), sobre episodios publicados en `SHOWCASE_STATUSES`, reproducidos con `@remotion/player` contra el manifest (D2), con el idioma de cada debate y sin el origen de las ediciones (D18). No usa `.mp4` (Feature 9 no existe).

- Dependencias de backend bloqueantes: **API-7** (`publish`/`unpublish` sobre el `publishedAt` de API-7a, `showcase.controller` con `GET /showcase/episodes` —con `language`— y `GET /showcase/episodes/:id`) y **API-8 en producción**, con el TTL de audio de 3600 s (D12) y sin `/docs` (D20). Ajuste de `coding-rules.md` §1 (varios controllers por módulo).
- Fuera de F4: la interfaz en `/en` y `/pt` con selector (i18n completo del showcase, nice-to-have, D16; ver "Backlog").
- Heredado de F1: la 404 del showcase en español y con `lang` en el HTML inicial, tanto para un `locale` inválido como para un episodio inexistente o no publicado (`tasks.md` §4). Si F4 vuelve a prerenderizar el showcase por el caché de AC 3.72, depende de que la canonicalización de mayúsculas de `proxy.ts` siga activa.
- [ ] Publicar/despublicar en el preview, con enlace público a `/es/e/[id]` (AC 3.64, AC 3.65)
- [ ] `/[locale]` — lista del showcase con distintivo de idioma del debate (AC 3.66, AC 3.71)
- [ ] `/[locale]/e/[id]` — player + transcripción + veredicto + distintivo de idioma desde `manifest.meta.language` (AC 3.67, AC 3.68, AC 3.70)
- [ ] `<html lang>` según el `locale` de la ruta y transcripción/veredicto marcados con el idioma del debate (AC 3.79 c)
- [ ] Rutas preparadas para i18n: interfaz en español, `/` → 307 a `/es`, cualquier otro `locale` → 404, enlaces internos siempre con el segmento de idioma (AC 3.80)
- [ ] Página 404 del showcase en español y con `lang` en el HTML inicial (AC 3.68, AC 3.80; diferida de F1, `tasks.md` §4)
- [ ] Caché y renovación de URLs acotadas al TTL (AC 3.72); ningún dato interno ni origen de argumentos expuesto (AC 3.69, D18)

**Criterio de completitud** (spec, F4): AC 3.64-3.72, AC 3.79 (c) y AC 3.80 cumplidos; sin sesión, el showcase funciona y ninguna respuesta de red contiene datos internos ni el origen de los argumentos; con curl sin sesión, las acciones devuelven `401`; un episodio sin publicar o despublicado responde `404` en `/showcase/episodes/:id`.

### Transversales (todas las fases)

AC 3.73-3.77 (estados de carga/vacío/error, fechas en zona del navegador, confirmación en acciones destructivas o que consumen presupuesto, 1280 px panel / 360 px showcase, teclado y foco). Se verifican al cerrar cada fase sobre las pantallas de esa fase, no como fase aparte. En F1, la de teclado y foco (AC 3.77) queda en la lista "Pendiente para cerrar la F1".

**Criterio de aceptación de la spec completa**: el de la sección "Criterio de aceptación" de la spec 003 (recorrido completo login → crear en un idioma distinto de español → publicar → despublicar, los 6 motivos resueltos al menos una vez desde la UI, AC 3.1-3.86 verificados).

## Backlog (nice-to-have, no se implementa sin pedirlo)

- **i18n completo de la interfaz del showcase** (spec 003, D16 y "MVP vs. nice-to-have"): interfaz también en `/en` y `/pt`, selector de idioma de interfaz, textos traducidos, `/` redirigiendo según el idioma del navegador y enlaces alternativos entre idiomas para buscadores. Objetivo fijado por el usuario, fuera de F4. Las rutas de F4 ya lo dejan preparado: ninguna URL existente cambia.

## Spec

La spec de UI está escrita: `../../../docs/product/003-dashboard-ui.md` (especificada y revisada por `architect`, 2026-09-25, ajustada el mismo día por la spec 004 y por el cierre de todas sus preguntas abiertas). Contiene mapa de rutas, mapeo de los 14 estados a UI y etiquetas de idioma, user stories y AC 3.1-3.86 por pantalla, edge cases, MVP vs. nice-to-have, dependencias de backend (API-1..API-19, con API-7a), restricciones técnicas (incluidos los dos layouts raíz) y el plan F1-F4 que sigue este roadmap. La topología de auth está en ADR 0001; las voces por agente e idioma, en ADR 0002. El comportamiento del pipeline según el idioma es de la spec 004 (`../../../docs/product/004-debate-language.md`); el dashboard solo lo consume (AC 4.20-4.23 = AC 3.22, 3.78, 3.17/3.26, 3.66/3.67).

## Preguntas abiertas

No quedan preguntas abiertas de la spec 003 ni de la 004 que afecten al front.

**Resueltas**:
- `publishedAt` en F2 → **API-7a** (decisión del usuario, spec 003 D10): la columna y su exposición en detalle y listado se adelantan a F2; `publish`/`unpublish` y `/showcase` siguen en F4 (API-7).
- Pregunta 4 (origen `HUMAN_EDITED` en el showcase) → **D18**: no se muestra.
- Pregunta 5 (veredicto tras editar/regenerar) → **D17**: aviso + "Volver a juzgar" (API-19, AC 3.81-3.85).
- Pregunta 7 (idioma de la interfaz del showcase) → **D16**: español en F4 bajo `/[locale]` con `es` como único valor; i18n completo como nice-to-have (ver "Backlog").
- Pregunta 8 (intervalos de polling) → **D19**: 30 s inbox, 10 s detalle y lista, centralizados (AC 3.86).
- Pregunta 10 (`/docs` en producción) → **D20**: solo fuera de producción, dentro de API-8.
- Preguntas A y B de la spec 004 → resueltas por el usuario (voces por idioma y voz de los episodios `ES` existentes). API-17 ya no depende de decisiones pendientes.
- 404 de un `locale` inválido durante F1-F3 → el usuario aceptó que `/en` y `/xx` respondan con la 404 por defecto de Next, en inglés, hasta la F4 (`decision-log.md` entrada 6).
