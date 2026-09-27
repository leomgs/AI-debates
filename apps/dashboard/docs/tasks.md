# Tasks — Dashboard (front)

Tracking de estado puramente del front. Convención: `[x]` hecho, `[ ]` pendiente, `[~]` empezado/parcial. Última revisión: 2026-09-27, octava pasada (§1 completa: verificaciones en navegador hechas por el usuario, todas OK). Séptima pasada, 2026-09-26 (F1 mergeada a `master` con fast-forward desde `feat/dashboard-f1`; §1 sin cambios de estado: siguen los `[~]` de verificación en navegador; §2 apunta a lo que se puede adelantar antes de API-17). Sexta pasada, mismo día (F1 implementada en la rama `feat/dashboard-f1`, §1). Quinta pasada, 2026-09-25 (API-8 hecha en el backend, §0). Cuarta pasada (spec 003 sin preguntas abiertas: D17-D20, AC 3.81-3.86, API-19 bloqueante de F2; nada implementado). Tercera pasada del mismo día: D16, AC 3.80, AC 3.79 partido en (a)/(b)/(c), dos layouts raíz, rutas del showcase bajo `/[locale]`; preguntas A y B de la spec 004 resueltas. Segunda pasada: tareas ajustadas por la spec 004 (API-7a, API-17, AC 3.78/3.79, selector y distintivos de idioma, sexto motivo `VOICE_NOT_CONFIGURED`). Revisión previa: 2026-09-25 (tareas reescritas según el plan F1-F4 de `docs/product/003-dashboard-ui.md`).

Cada tarea cita su origen en la spec 003 (AC 3.x, D-n, API-n o "Restricciones técnicas"). "Requiere" indica una dependencia explícita con otra tarea de este archivo (§n) o con backend (API-n, trackeado en `tasks.md` de la raíz §12; API-17, en §13). Antes de escribir código de Next: leer la guía de la versión instalada en `node_modules/next/dist/docs/` (`apps/dashboard/AGENTS.md`).

## 0. Dependencias (backend/infra, no se trackean acá)

Bloqueantes previos resueltos:

- [x] `docs/product/001-openapi-contract-zod.md` implementada (raíz, `tasks.md` §10)
- [x] `docs/product/002-workspace-restructure.md` implementada (raíz, `tasks.md` §11) — scaffold de `apps/dashboard`

Dependencias de backend/workspace de la spec 003, trackeadas en `tasks.md` de la raíz §12 (orden según la fase que desbloquean):

- [x] Antes de F1: API-8 (auth, ADR 0001; incluye `/docs` solo fuera de producción, D20) **hecha 2026-09-25**; `check-boundaries` extendido a `apps/dashboard` y `dev.dependsOn: ["^build"]` en el `turbo.json` raíz **hechos 2026-09-26** en la rama `feat/dashboard-f1`, mergeada a `master`. Datos de API-8 que usa el front: la cookie se llama `atd_session` (la mira `src/proxy.ts`); `POST /auth/login` responde `401 INVALID_CREDENTIALS` (AC 3.2) o `429 TOO_MANY_ATTEMPTS` con `Retry-After` (AC 3.8), distinto del `401 UNAUTHORIZED` de sesión ausente o vencida en el resto de la API (AC 3.5, 3.7); `GET /auth/session` devuelve `{ authenticated: true, expiresAt }` o `401`; `POST /auth/logout` responde `204` (ver `api-contract.md` §1.1 de la raíz)
- [~] Antes de F2: API-1, API-5, API-7a, API-12, API-13, API-17, API-19 (bloqueantes); API-10b (recomendada, pero prerrequisito de API-19 en el backend); API-10, API-14, API-16 (recomendadas); API-18 (no bloqueante). **Hechas 2026-09-25**: API-1 parte 1 (sin `language`), API-5, API-7a, API-12 y API-13 (raíz, `decision-log.md` entrada 34). **Hechas 2026-09-26**: API-10b, API-14, API-15 y API-19 (raíz, `decision-log.md` entrada 35). Datos que usa el front (ver `api-contract.md` §1, §2, §3, §4 y §6 de la raíz):
  - `GET /episodes/:id` suma `pipelineActive`, `topic { id, title }`, `createdAt`, `publishedAt` (siempre `null` hasta API-7) y `participants[] { agentId, name, role, isJudge }` (debatientes primero, juez al final; vacío en `CREATED`). `GET /episodes` suma `publishedAt`
  - SSE: episodio inexistente → `404 NOT_FOUND` (JSON); existente sin pipeline activo → `204` sin body ni `Content-Type: text/event-stream` (para `EventSource`, "no reconectar"); con pipeline activo → `200 text/event-stream`, con `event: heartbeat` cada 15 s. El heartbeat sale sin línea `data:`, así que `EventSource` no lo despacha y nunca llega al feed. `research.started` y `episode.pending_review` llegan con `data: {}`
  - `/notifications`: `NotificationDto` (`readAt` nullable); `POST /notifications/read-all` responde `{ count }`. Los dos POST responden `201`
  - `participants[].role` sale en `openapi.json` como `type: ["string","null"]`, igual que `avatarUrl`: `openapi-typescript` genera `string | null` para los dos (verificado en F1, §1)
  - API-19: `debate.verdict.stale: boolean` en `GET /episodes/:id` (AC 3.81). Acción `POST /episodes/:id/actions/regenerate-verdict` con body `{}` obligatorio (sin body o con campos de más → `400 VALIDATION_ERROR`); responde `201` con el veredicto nuevo en el shape de `debate.verdict` y `stale: false`, y `verdict.id` cambia en cada vuelta. Es sincrónica (espera de RPM de hasta unos 90 s más reintentos). Errores: `409 INVALID_STATE_TRANSITION` (fuera de `PENDING_REVIEW` o si el estado cambió durante la llamada), `409 USAGE_LIMIT_EXCEEDED`, `503 PROVIDER_QUOTA_EXCEEDED`, `500 INTERNAL_ERROR` (AC 3.85). Todavía no está en `openapi.json` como acción tipada: el path param `action` y las respuestas por acción los documenta API-10
  - API-10b: `regenerate` y `regenerate-audio` ya responden `409 USAGE_LIMIT_EXCEEDED` y `503 PROVIDER_QUOTA_EXCEEDED` (antes `500`; AC 3.50, 3.62). API-14: `edit`/`regenerate` con un `argumentId` de otro episodio → `404 NOT_FOUND` (AC 3.50: refrescar el detalle)
  - `RemotionManifest.meta.language` ya es obligatorio (`DebateLanguage` en `@ai-trend-debates/contracts`); sale `"ES"` hasta que la spec 004 agregue el idioma por episodio
- [x] API-17 (y el `language` de API-1) — **hecho 2026-09-27** (raíz, `decision-log.md` entradas 36-38). Lo entregó la spec 004: `tasks.md` de la raíz §13. Sus preguntas abiertas A y B ya están resueltas; lo que queda es trabajo de backend en serie (voces `EN`/`PT`, migración, TTS, API)
- [ ] Antes de F3: `packages/video` como librería con audio real + catálogo de pnpm (Restricciones técnicas, puntos 1-4)
- [ ] Antes de F4: API-7; API-8 en producción con TTL de audio 3600 s (D12) y sin `/docs` (D20); ajuste de `coding-rules.md` §1

## 1. F1 — Base: auth, origen único, cliente tipado, layouts — implementada 2026-09-26 y mergeada a `master` (fast-forward desde `feat/dashboard-f1`), verificada en navegador 2026-09-27: COMPLETA

Requiere API-8 (§0). Criterio: ver `roadmap.md`, Fase 1. Proceso y hallazgos en `decision-log.md` de esta carpeta, entrada 6. Las verificaciones a mano en navegador las hizo el usuario el 2026-09-27 con `pnpm dev` (login con vuelta a `next`, recargas, pestaña de red, aviso de sesión vencida, cerrar sesión, teclado y foco): todas OK. Lista en `roadmap.md`, Fase 1, "Pendiente para cerrar la F1".

- [x] Instalar shadcn/ui, TanStack Query, `openapi-typescript` y `openapi-fetch` (D4). shadcn/ui con base Radix (`button`, `input`, `label`); el CLI actual trae el paquete `cn` (de `shadcn-ui`) en lugar de `clsx` + `tailwind-merge`. Se sumó Vitest 4 (dev) para los tests unitarios del front
- [x] `apps/dashboard/turbo.json` con `extends: ["//"]` y tarea `generate:api` → `src/lib/api/schema.d.ts` (generado, en `.gitignore`); `build`/`dev`/`lint`/`test` dependen de ella; `build` y `dev` con `env: ["API_INTERNAL_URL"]` (Restricciones técnicas, "Turborepo y tipos")
- [x] Verificar qué genera `openapi-typescript` con `avatarUrl` (`type: ["string","null"]` en un documento 3.0.0): con `openapi-typescript` 7.13.0 sale `avatarUrl: string | null` (requerido), igual que `participants[].role: string | null`. No hace falta tocar el backend (Restricciones técnicas, "Tipos generados")
- [x] Rewrites `/api/:path*` y `/audio-files/:path*` hacia `API_INTERNAL_URL` (ADR 0001 punto 3; AC 3.9). Default `http://127.0.0.1:3000`, el `HOST`/`PORT` por defecto de la API (`main.ts` ya usa `PORT` desde API-8); la URL se valida al cargar `next.config.ts`
- [x] `experimental.proxyTimeout` de 10 minutos, por encima del peor caso de `regenerate-verdict` (API-19, sincrónica): 3 intentos de Cockatiel × (hasta 90 s de espera del limitador de RPM + generación) + backoff, unos 5-6 minutos; cubre también el SSE junto con el `heartbeat` (Restricciones técnicas, "Rewrites y SSE")
- [x] Cliente `openapi-fetch`: `baseUrl` `/api` en el navegador (`src/lib/api/client.ts`), `API_INTERNAL_URL` en el render de servidor (`server-client.ts`, `server-only`, sin reenviar cookies ni headers; se usa recién en F4) (D11)
- [x] Provider de TanStack Query + manejo global del `401` → `/login?next=<ruta actual>&expired=1` con aviso de acción no ejecutada (AC 3.7). Solo dispara con `code: UNAUTHORIZED`, no con el `401 INVALID_CREDENTIALS` del login. Probado con tests de `QueryClient` y en navegador (2026-09-27)

**Layouts raíz separados** (Restricciones técnicas, "Layouts raíz separados para panel y showcase"; AC 3.79 a; D16):
- [x] Separar los layouts raíz: eliminado `src/app/layout.tsx` (y la página del scaffold); sin layout compartido
- [x] `app/(panel)/layout.tsx` con `<html lang="es">`, que contiene `login/` y `studio/`; las URLs siguen siendo `/login` y `/studio/*` (AC 3.79 a; verificado con curl: `lang="es"` en `/login`, `/studio` y `/studio/new`)
- [x] `app/[locale]/layout.tsx` con `<html lang={locale}>`, `es` como único valor válido: `generateStaticParams` + `dynamicParams = false` + `notFound()` en el layout. Desde el review de F1 el segmento es `force-dynamic` (ver el ítem de mayúsculas más abajo), así que el que responde el 404 es el `notFound()` del layout; `locale` en `src/lib/locales.ts`, lista propia del dashboard, no derivada de `DebateLanguage` (D16; Restricciones técnicas, "Tipos generados")
- [x] `/` → redirección temporal (307) a `/es` (D16), con `redirects` de `next.config.ts`
- [x] Spike de `global-not-found`: el flag `experimental.globalNotFound` existe en 16.3.6 y se usa (`app/global-not-found.tsx`, en español, `lang="es"`), más un `not-found.tsx` dentro de cada layout raíz para los `notFound()` de páginas. Hallazgos en `decision-log.md` entrada 6: con Turbopack el archivo se toma aun sin el flag, y un `notFound()` lanzado durante un render dinámico sale como documento de error de Next que se completa en el cliente (status 404 correcto)
- [x] Verificar la convivencia de rutas: `login` y `studio` tienen prioridad sobre `[locale]`, y los rewrites `/api/*` y `/audio-files/*` no caen en `[locale]` (curl: `/api/episodes` → `401` de Nest, `/audio-files/x.mp3` → `403` de la firma HMAC)
- [x] Verificar: `/` redirige a `/es` (307) y `/en` responde 404 (criterio F1); también `/pt` y `/xx`. `/foo/bar` responde 404 con `global-not-found`; los `locale` inválidos, con la 404 por defecto de Next (se corrige en F4, ver §4)
- [x] Paths con mayúsculas (review de F1): en un filesystem que no distingue mayúsculas, `/ES` o `/Studio` pisaban en el caché ISR el prerender de `/es` y `/studio`, que quedaban en 404 hasta el próximo build; además `/Studio` salteaba el chequeo de la cookie. `proxy.ts` redirige con 308 cualquier variante con mayúsculas (también codificada, `/%53tudio`) a su path en minúsculas, y el panel y el showcase son `force-dynamic` (sin prerender en disco). Reproducido antes y después del fix con `next start` y un reinicio en el medio (`decision-log.md` entrada 6)

**Auth y navegación:**
- [x] `src/proxy.ts`: chequeo optimista de la cookie `atd_session` en `/studio` y `/studio/*` → `/login?next=` (AC 3.1; ADR 0001 punto 4). Corre sobre todo salvo `/_next`, `/api` y `/audio-files`, porque antes canonicaliza las mayúsculas del path (ítem de mayúsculas, arriba)
- [x] Validación de `next`: solo `/studio` o `/studio/...` ya resuelto (sin `//`, `\`, caracteres de control ni `..` que salga del panel); cualquier otro valor → `/studio` (AC 3.1). Se valida en el servidor, antes de llegar al formulario
- [x] Página `/login` contra `POST /auth/login`: error único sin indicar campo (AC 3.2), mensaje específico de rate-limit con los minutos de `Retry-After` (AC 3.8) y otro para `LOGIN_BUSY`. Verificado con curl a través del rewrite (login real `200` con cookie `HttpOnly; SameSite=Lax; Max-Age=604800`, `401 INVALID_CREDENTIALS`, `429 TOO_MANY_ATTEMPTS` con `Retry-After: 900`); formulario probado en navegador (2026-09-27)
- [x] Persistencia de sesión 7 días (AC 3.3): la cookie sale con `Max-Age=604800` y `/studio` y `GET /auth/session` responden `200` con ella en cada request (curl); recargas probadas en navegador (2026-09-27). `SessionCheck` consulta `GET /auth/session` en todo `/studio/*`, así que una cookie vencida o alterada lleva a `/login`
- [x] "Cerrar sesión" contra `POST /auth/logout` (AC 3.4): `204` que borra la cookie, y después `/studio` → `307` a `/login` (curl); botón probado en navegador (2026-09-27)
- [x] Layout del panel `/studio/*` con navegación: episodios, crear, showcase (`/es`, con `<a>` porque es otro layout raíz), cerrar sesión (AC 3.15). `/studio` y `/studio/new` son placeholders hasta F2
- [x] Layout del showcase (`/[locale]`) sin controles ni enlaces del panel; `/`, `/[locale]` y `/[locale]/e/[id]` sin sesión (AC 3.6). `/es/e/[id]` responde 404 hasta F4 (no hay episodios publicados)
- [x] Mapeo de los 14 `EpisodeStatus` a etiqueta/categoría/grupo/terminal/actualización como módulo compartido (`src/lib/episode-status.ts`), con el tipo sacado de `openapi.json` (spec, "Mapeo de estados a UI")
- [x] Verificar con curl contra `/api/...` que los endpoints no públicos devuelven `401 UNAUTHORIZED` (AC 3.5): hecho (episodios, detalle, SSE, manifest, acciones, notificaciones, sesión). AC 3.9: la URL interna no aparece en el HTML ni en ningún chunk de `.next/static` (solo en el `routes-manifest.json` del servidor); pestaña de red revisada en navegador (2026-09-27): todo sale a `localhost:3001`
- [x] Verificar criterio F1: `pnpm build` verde; renombrar `COMPLETED` en el enum de estados o `password` en `LoginDto` de `openapi.json` hace fallar el build del dashboard (`TS2353`); un import prohibido hace fallar `check-boundaries` y corta `pnpm build`

## 2. F2 — Panel de curación (privado) — sin empezar

Requiere §1 completa y API-1, API-5, API-7a, API-12, API-13, API-17, API-19 (§0). Criterio: ver `roadmap.md`, Fase 2. Qué se puede adelantar antes de API-17 con lo que ya está en `master`, y con qué criterio: `roadmap.md`, Fase 2, "Qué se puede adelantar antes de API-17".

**Compartido:**
- [ ] Constantes de polling en un único módulo: 30 s inbox, 10 s detalle (fases sin SSE) y lista; ninguna pantalla define su propio intervalo (AC 3.86; D19). Verificable por revisión de código
- [ ] Mapeo de `DebateLanguage` a etiqueta (`ES` → "Español", `EN` → "English", `PT` → "Português") como módulo compartido, con el tipo del enum generado de `openapi.json`, nunca una lista escrita a mano (spec, "Mapeo de estados a UI"; D5; Restricciones técnicas, "Tipos generados") — requiere API-17
- [ ] Componente de distintivo de idioma: código compacto (`ES`/`EN`/`PT`) con el nombre completo accesible, por ejemplo en un tooltip (spec, "Mapeo de estados a UI")

**Inbox (sección 2 de la spec)** — requiere API-5:
- [ ] Contador de no leídas en el header, polling de 30 s desde las constantes (D19) + refetch al volver el foco (AC 3.10)
- [ ] Lista del inbox con mensaje, tipo con categoría visual y fecha relativa (AC 3.11, AC 3.74)
- [ ] Click → `markNotificationRead` + navegación al episodio (AC 3.12)
- [ ] "Marcar todas como leídas" (AC 3.13)
- [ ] Inbox vacío y contador ante error de consulta (AC 3.14)

**Lista `/studio` (sección 3)** — requiere API-1 (`language`) y API-7a:
- [ ] Agrupación Requiere acción / En curso / Terminados, orden por fecha (AC 3.16)
- [ ] Fila con título truncado, distintivo de idioma, etiqueta de estado, fecha y distintivo "Publicado" si `publishedAt` no es nulo (AC 3.17; "Publicado" verificado con `publishedAt` puesto a mano hasta que exista API-7)
- [ ] Contador y estado vacío de "Requiere acción" (AC 3.18)
- [ ] Filtro multi-estado en la URL, tolerante a valores inválidos (AC 3.19)
- [ ] Estados vacío/carga/error (AC 3.20, AC 3.73)
- [ ] Auto-refresco de 10 s (constantes, D19) mientras haya episodios "En curso" (AC 3.21)

**Crear `/studio/new` (sección 4)** — requiere API-17 (hecho 2026-09-27). Nota del review de 13.7: `openapi-typescript` (con `defaultNonNullable`) genera `CreateEpisodeDto.language` como **requerido** porque el schema tiene `default: "ES"`; la API lo acepta omitido (AC 4.2), pero el formulario siempre lo manda (AC 3.22), así que no hace falta cambiar la generación. Crear un episodio `EN`/`PT` responde `409 VOICE_NOT_CONFIGURED` mientras no haya voces (spec 004, D20, AC 4.29): es el caso de AC 3.78. En el manifest, `agents[].voiceId` puede ser `null` (el juez siempre).
- [ ] Formulario `topic` con contador y validación 1-300 tras recortar (AC 3.22)
- [ ] Selector de idioma con Español, English y Português, Español preseleccionado, siempre enviado en `createEpisode`, con nota de que el idioma no se puede cambiar después (AC 3.22; D15; AC 4.20)
- [ ] Envío sin duplicados y navegación al detalle (AC 3.23, AC 3.24)
- [ ] Errores `VALIDATION_ERROR` junto al campo y genérico conservando el texto y el idioma elegidos (AC 3.25)
- [ ] `409 VOICE_NOT_CONFIGURED`: mensaje junto al selector de idioma ("No hay voces configuradas para <idioma>…") más el `error.message` del backend si trae detalle; conserva texto e idioma (AC 3.78; AC 4.21)

**Detalle `/studio/episodes/[id]` (sección 5)** — requiere API-1, API-7a y API-12:
- [ ] Cabecera: tópico, distintivo de idioma, estado, fecha, "Publicado" si `publishedAt` no es nulo, acceso al preview (AC 3.26; AC 4.22)
- [ ] Timeline por ronda con nombre de agente y distintivo de origen (AC 3.27)
- [ ] Referencia y salto a `respondsToId` en `CROSS_EXAMINATION` (AC 3.28)
- [ ] Veredicto con juez y ganador / "Sin ganador" (AC 3.29)
- [ ] Argumentos, veredicto y feed marcan su bloque con el `lang` del idioma del episodio (`es`/`en`/`pt`), dentro del documento `lang="es"` del panel (AC 3.79 b; requiere API-17)
- [ ] Barras de uso vs. límites, umbrales 80 %/100 %, `usage` null, `executionTime` legible (AC 3.30)
- [ ] Historial de checkpoints con motivo en español, incluido `VOICE_NOT_CONFIGURED` (AC 3.31)
- [ ] Bloques `FAILED`/`CANCELLED` y pantalla 404 (AC 3.40, AC 3.41)

**Vista en vivo (sección 5)** — requiere API-12 y API-13:
- [ ] Spike: la compresión no bufferea `text/event-stream` a través del rewrite (Restricciones técnicas, "Rewrites y SSE")
- [ ] Cliente SSE con `addEventListener` por tipo de evento, solo en estados "SSE" con `pipelineActive` (AC 3.32; Restricciones técnicas, "Cliente SSE")
- [ ] Feed de actividad traducido + indicador en vivo/desconectado, sin `heartbeat` en el feed (AC 3.32, AC 3.33, AC 3.37)
- [ ] Refetch del detalle por cada evento de negocio, sin reconstruir estado (AC 3.34, D7)
- [ ] Polling de 10 s (constantes, D19) en `APPROVED`/`GENERATING_AUDIO`/`RENDERING` con `pipelineActive` (AC 3.35)
- [ ] Cierre sin reintento en estados frenados/terminales (AC 3.36)
- [ ] Reconexión condicionada en `onerror` + `401` vía refetch (AC 3.38, AC 3.7)
- [ ] Mensaje de episodio trabado con `pipelineActive: false` (AC 3.39)
- [ ] Verificar: 60 s sin eventos de negocio sin reconexiones (AC 3.33)

**Curaduría en `PENDING_REVIEW` (sección 6):**
- [ ] Controles visibles solo en los estados de `api-contract.md` §5 y API-19 (AC 3.42)
- [ ] Aprobar con confirmación y paso a polling hasta `READY_FOR_RENDER` (AC 3.43)
- [ ] Editor inline de un argumento a la vez (AC 3.44)
- [ ] Regenerar argumento con confirmación de los 3 avisos y estado "Regenerando…" (AC 3.45, AC 3.75)
- [ ] Deshabilitar "Regenerar" con presupuesto LLM agotado (AC 3.46)
- [ ] Rechazar con diálogo destructivo (AC 3.47)
- [ ] `409 INVALID_STATE_TRANSITION` → refetch + aviso (AC 3.48)
- [ ] Bloqueo de acciones concurrentes sobre el mismo episodio (AC 3.49)
- [ ] Errores específicos de `regenerate` (AC 3.50; mensajes específicos requieren API-10b, `404` de argumento requiere API-14)

**Veredicto desactualizado y "Volver a juzgar" (sección 6; D17)** — requiere API-19:
- [ ] Aviso "Este veredicto es anterior a cambios en los argumentos…" en el bloque del veredicto cuando `debate.verdict.stale` es verdadero en `PENDING_REVIEW`; aparece tras `edit`/`regenerate` y desaparece al volver a estar al día, sin recargar (AC 3.81; D7)
- [ ] Botón "Volver a juzgar" (`regenerate-verdict`) siempre visible en `PENDING_REVIEW`, destacado con el aviso; confirmación con el costo a la vista (1 llamada LLM, usadas y límite) y el aviso de que reemplaza veredicto y ganador; "Juzgando…" mientras corre, con AC 3.49; refetch al terminar (AC 3.82, AC 3.75)
- [ ] Deshabilitar "Volver a juzgar", con la explicación a la vista, si `usage.llmCalls >= limits.maxLlmCalls` (AC 3.83)
- [ ] Confirmación de "Aprobar" con veredicto desactualizado: advertencia "El veredicto es anterior a tus cambios y es el que se va a publicar" y "Volver a juzgar" como alternativa en el mismo diálogo (AC 3.84)
- [ ] Errores de `regenerate-verdict`: `409 USAGE_LIMIT_EXCEEDED` y `503 PROVIDER_QUOTA_EXCEEDED` con los mensajes de AC 3.50; `409 INVALID_STATE_TRANSITION` como en AC 3.48; el veredicto anterior queda y el bloque nunca queda en "Juzgando…" (AC 3.85)

**Resolución de `REQUIRES_HUMAN_REVIEW` (sección 7):**
- [ ] Panel de resolución con motivo, `fromState`, ronda, sobre el checkpoint más reciente (AC 3.51)
- [ ] Panel `USAGE_LIMIT_EXCEEDED`: formulario de límites > consumo actual; caso `ttsRequests` solo "Rechazar" hasta API-16 (AC 3.51)
- [ ] Panel `INSUFFICIENT_EVIDENCE`: formulario de fuentes manuales `{ url, title, snippet }` (AC 3.51)
- [ ] Panel `MAX_REVISIONS_EXCEEDED`: reanudar `{}` / rechazar (AC 3.51)
- [ ] Panel `VALIDATION_INCONSISTENCY`: agente afectado (API-1), "Reanudar" deshabilitado con explicación (AC 3.51, D13)
- [ ] Panel `PROVIDER_QUOTA_EXCEEDED`: reanudar `{}` / rechazar (AC 3.51)
- [ ] Panel `VOICE_NOT_CONFIGURED`: idioma del episodio y agentes sin voz (API-18; mientras no exista, los participantes del episodio de API-1 como agentes a revisar), explicación de que se corrige en el seed de voces de la API, "Reanudar" `{}` **habilitado** o "Rechazar" (AC 3.51; requiere API-17)
- [ ] Aviso de repetición de motivo junto a "Reanudar", con el agregado específico de `PROVIDER_QUOTA_EXCEEDED` y de `VOICE_NOT_CONFIGURED` (reanudar sin corregir las voces gasta el reintento) (AC 3.52)
- [ ] Body exacto por motivo, reapertura de SSE o polling según `fromState` (`GENERATING_AUDIO` → polling, también para `VOICE_NOT_CONFIGURED`) (AC 3.53)
- [ ] `VALIDATION_ERROR` dentro del formulario sin perder datos (AC 3.54)
- [ ] Panel genérico para motivo desconocido (AC 3.55)
- [ ] Verificar criterio F2: crear un episodio en cada idioma con voces configuradas → en vivo hasta `PENDING_REVIEW` sin cortes; crear en un idioma sin voces muestra AC 3.78; editar un argumento hace aparecer el aviso de veredicto desactualizado y "Volver a juzgar" lo hace desaparecer; forzar y resolver cada uno de los 6 motivos en local (para `VOICE_NOT_CONFIGURED`, quitando una voz del seed); "Publicado" con `publishedAt` puesto a mano

## 3. F3 — Preview con audio — sin empezar

Requiere §2 (detalle) y el refactor de `packages/video` + catálogo de pnpm (§0). Criterio: ver `roadmap.md`, Fase 3.

- [ ] Ruta `/studio/episodes/[id]/preview` con `@remotion/player` sobre la composición de `@ai-trend-debates/video` y `DEBATE_VIDEO` (AC 3.56; D5)
- [ ] Lista de segmentos con salto del player (AC 3.57)
- [ ] Estado vacío ante `409 MANIFEST_NOT_READY` o estado previo (AC 3.58)
- [ ] Renovación del manifest ante un audio que falla al cargar, retomando la posición (AC 3.59)
- [ ] Segmento sin `audioUrl`: silencio por su duración + marca "sin audio" (AC 3.63)
- [ ] "Regenerar audio" por segmento con confirmación (aviso de publicado) y "Regenerando…" (AC 3.60, AC 3.75)
- [ ] Deshabilitar con presupuesto TTS agotado (AC 3.61)
- [ ] Manejo de errores de `regenerate-audio` (AC 3.62; mensajes específicos requieren API-10b)
- [ ] Verificar AC 3.59 con TTL corto en local (60 s)
- [ ] Verificar criterio F3: approve lleva sin recargar a un preview con sonido

## 4. F4 — Publicación y showcase público (interfaz en español) — sin empezar

Requiere §3 y API-7 (§0). Criterio: ver `roadmap.md`, Fase 4. Fuera de esta fase: `/en`, `/pt` y el selector de idioma de interfaz (§6, D16).

- [ ] "Publicar" en el preview con confirmación (visible para cualquiera en `/es` y `/es/e/[id]`), distintivo y enlace público a `/es/e/[id]` (AC 3.64)
- [ ] "Despublicar" con confirmación; deja de aparecer en `/[locale]` y `/[locale]/e/[id]` responde "no encontrado" (AC 3.65)
- [ ] `/[locale]` con `listShowcaseEpisodes`, render de servidor contra `API_INTERNAL_URL`, con distintivo de idioma del debate por episodio (AC 3.66, D11; AC 4.23)
- [ ] Showcase vacío (AC 3.71)
- [ ] `/[locale]/e/[id]` con player, transcripción por segmento, veredicto y distintivo de idioma desde `manifest.meta.language`, sin distintivo de origen de los argumentos (AC 3.67; AC 4.23; D18)
- [ ] `<html lang>` según el `locale` de la ruta (en F4, siempre `es`), y transcripción y veredicto marcados con el idioma del debate (AC 3.79 c)
- [ ] Interfaz del showcase en español (etiquetas, botones, textos fijos, mensajes de vacío y error); enlaces internos y el del preview siempre con el segmento de idioma (AC 3.80)
- [ ] Verificar AC 3.80: `/` → 307 a `/es`; `/es` y `/es/e/[id]` funcionan; `/en`, `/pt`, `/xx` y `/en/e/[id]` → 404
- [ ] "No encontrado" para inexistente, no publicado o fuera de `SHOWCASE_STATUSES` (AC 3.68)
- [ ] Página 404 del showcase en español y con `lang` (AC 3.68, AC 3.80; sale de la F1, `decision-log.md` entrada 6). Hoy el status es correcto (404), pero lo que se ve no:
  - un `notFound()` en `/es/e/[id]` responde con `<html id="__next_error__">` sin `lang`, con "This page could not be found" en el HTML inicial, y el `not-found.tsx` del showcase recién aparece en el cliente;
  - un `locale` inválido (`/en`, `/xx`, `/en/e/[id]`) muestra la 404 por defecto de Next, en inglés, porque el `notFound()` sale del layout raíz, que no tiene boundary propio.

  En F4, `/es/e/[id]` va a devolver 404 de verdad para los episodios no publicados, así que la 404 tiene que salir bien en el HTML inicial: en español, con `lang="es"` y sin controles del panel. Son dos casos distintos (ADR 0001, "Aclaración: alcance de `src/proxy.ts`"):
  - episodio inexistente o no publicado en `/es/e/[id]`: necesita datos, así que sale obligatoriamente del render, resolviendo el episodio antes del stream (por ejemplo, con un `generateMetadata` o un fetch que corte antes). El proxy no puede resolverlo;
  - `locale` inválido (`/en`, `/xx`, `/en/e/[id]`): se puede resolver en el render o desde `proxy.ts`, reescribiendo contra `SHOWCASE_LOCALES` hacia `global-not-found`. Antes, spike: verificar que en 16.3.6 un `NextResponse.rewrite` desde el proxy hacia un path sin ruta renderiza `global-not-found` con status 404 real.

  Si F4 vuelve a prerenderizar el showcase por el caché de AC 3.72, depende de que la canonicalización de mayúsculas de `proxy.ts` siga activa
- [ ] Título y transcripción en el HTML inicial + metadatos por episodio (AC 3.70)
- [ ] Caché del HTML y de respuestas con `audioUrl` acotada al TTL; renovación como en AC 3.59 (AC 3.72)
- [ ] Layout usable a 360 px (AC 3.76)
- [ ] Verificar sin sesión: ninguna respuesta de red contiene datos internos ni el origen de los argumentos (AC 3.69, D18; `language` sí es público); acciones con curl → `401`; despublicado → `404`

## 5. Transversales — sin empezar

Se verifican al cerrar cada fase sobre sus pantallas.

- [ ] Estados de carga/vacío/error en toda pantalla con datos (AC 3.73)
- [ ] Fechas en zona del navegador, relativas con absoluta en tooltip (AC 3.74)
- [ ] Confirmación en `reject`/`publish`/`unpublish`/`regenerate`/`regenerate-audio`/`regenerate-verdict` y en ninguna otra (AC 3.75, AC 3.82)
- [ ] Panel usable a 1280 px (AC 3.76)
- [ ] Teclado y foco atrapado en diálogos, verificado (AC 3.77)
- [ ] Ningún tipo de la API escrito a mano (D5), incluido `DebateLanguage` — revisión al cerrar cada fase
- [x] Tema oscuro fijo en todo el dashboard (D21, 2026-09-27): clase `dark` en el `<html>` de `(panel)`, `[locale]` y `global-not-found`, y `color-scheme: dark` en `globals.css`. Las pantallas nuevas usan los tokens de shadcn (`bg-background`, `text-muted-foreground`, etc.) y no colores fijos, para no reintroducir fondos blancos

## 6. Backlog — nice-to-have (no se implementa sin pedirlo)

- [ ] **i18n completo de la interfaz del showcase** (spec 003, D16 y "MVP vs. nice-to-have"; fuera de F4): interfaz también en `/en` y `/pt`, selector de idioma de interfaz visible en el showcase, textos traducidos, `/` redirigiendo según el idioma del navegador, y enlaces alternativos entre idiomas para buscadores. No cambia ninguna URL existente.

## Referencias

- `roadmap.md` (esta carpeta) — secuenciación, objetivo, dependencias y criterio de completitud de cada fase.
- `decision-log.md` (esta carpeta) — decisiones ya tomadas (framework, dependencias).
- `docs/product/003-dashboard-ui.md` — spec de UI (AC 3.1-3.86, API-1..API-19 con API-7a, plan F1-F4, D16-D20).
- `docs/product/004-debate-language.md` — idioma del debate (AC 4.20-4.23 se implementan acá, vía los AC 3.x equivalentes).
- `docs/adr/0001-auth-sesion-nest-mismo-origen.md` — auth y origen único.
- `docs/adr/0002-voces-por-agente-e-idioma.md` — voces por agente e idioma, origen de `VOICE_NOT_CONFIGURED`.
- `tasks.md` de la raíz §12 — dependencias de backend de la spec 003 (incluida API-19); §13 — spec 004 (entrega API-17).
