# Tasks — Dashboard (front)

Tracking de estado puramente del front. Convención: `[x]` hecho, `[ ]` pendiente, `[~]` empezado/parcial. Última revisión: 2026-09-25 (tareas reescritas según el plan F1-F4 de `docs/product/003-dashboard-ui.md`; nada implementado).

Cada tarea cita su origen en la spec 003 (AC 3.x, D-n, API-n o "Restricciones técnicas"). "Requiere" indica una dependencia explícita con otra tarea de este archivo (§n) o con backend (API-n, trackeado en `tasks.md` de la raíz §12). Antes de escribir código de Next: leer la guía de la versión instalada en `node_modules/next/dist/docs/` (`apps/dashboard/AGENTS.md`).

## 0. Dependencias (backend/infra, no se trackean acá)

Bloqueantes previos resueltos:

- [x] `docs/product/001-openapi-contract-zod.md` implementada (raíz, `tasks.md` §10)
- [x] `docs/product/002-workspace-restructure.md` implementada (raíz, `tasks.md` §11) — scaffold de `apps/dashboard`

Dependencias de backend/workspace de la spec 003, trackeadas en `tasks.md` de la raíz §12 (orden según la fase que desbloquean):

- [ ] Antes de F1: API-8 (auth, ADR 0001); `check-boundaries` extendido a `apps/dashboard`; `dev.dependsOn: ["^build"]` en el `turbo.json` raíz
- [ ] Antes de F2: API-1, API-5, API-12, API-13 (bloqueantes); API-10, API-10b, API-14, API-16 (recomendadas)
- [ ] Antes de F3: `packages/video` como librería con audio real + catálogo de pnpm (Restricciones técnicas, puntos 1-4)
- [ ] Antes de F4: API-7; API-8 en producción con TTL de audio 3600 s (D12); ajuste de `coding-rules.md` §1

## 1. F1 — Base: auth, origen único, cliente tipado, layout — sin empezar

Requiere API-8 (§0). Criterio: ver `roadmap.md`, Fase 1.

- [ ] Instalar shadcn/ui, TanStack Query, `openapi-typescript` y `openapi-fetch` (D4)
- [ ] `apps/dashboard/turbo.json` con `extends: ["//"]` y tarea `generate:api` → `src/lib/api/schema.d.ts`; `build`/`dev`/`lint` dependen de ella, con `env: ["API_INTERNAL_URL"]` (Restricciones técnicas, "Turborepo y tipos")
- [ ] Verificar qué genera `openapi-typescript` con `avatarUrl` (`type: ["string","null"]` en un documento 3.0.0) (Restricciones técnicas, "Tipos generados")
- [ ] Rewrites `/api/:path*` y `/audio-files/:path*` hacia `API_INTERNAL_URL` (apuntando al puerto 3000 fijo de `main.ts:54`) + `experimental.proxyTimeout` alto (ADR 0001 punto 3; AC 3.9)
- [ ] Cliente `openapi-fetch`: `baseUrl` `/api` en el navegador, `API_INTERNAL_URL` en el render de servidor, sin reenviar cookies (D11)
- [ ] Provider de TanStack Query + manejo global del `401` → `/login?next=<ruta actual>` con aviso de acción no ejecutada (AC 3.7)
- [ ] `src/proxy.ts`: chequeo optimista de la cookie en `/studio/*` → `/login?next=` (AC 3.1; ADR 0001 punto 4)
- [ ] Validación de `next`: solo rutas relativas `/studio/...`, cualquier otro valor → `/studio` (AC 3.1)
- [ ] Página `/login` contra `POST /auth/login`: error sin indicar campo (AC 3.2), mensaje específico de rate-limit (AC 3.8)
- [ ] Persistencia de sesión 7 días verificada con recargas (AC 3.3)
- [ ] "Cerrar sesión" contra `POST /auth/logout` (AC 3.4)
- [ ] Layout del panel `/studio/*` con navegación: lista, crear, showcase, cerrar sesión (AC 3.15)
- [ ] Layout del showcase sin controles ni enlaces del panel (AC 3.6)
- [ ] Mapeo de los 14 `EpisodeStatus` a etiqueta/categoría/grupo/actualización como módulo compartido (spec, "Mapeo de estados a UI")
- [ ] Verificar con curl contra `/api/...` que los endpoints no públicos devuelven `401 UNAUTHORIZED` (AC 3.5) y que la pestaña de red solo muestra el origen del dashboard (AC 3.9)
- [ ] Verificar criterio F1: `pnpm build` verde; un cambio en `openapi.json` que rompe un tipo usado hace fallar el build; un import prohibido hace fallar `check-boundaries`

## 2. F2 — Panel de curación (privado) — sin empezar

Requiere §1 completa y API-1, API-5, API-12, API-13 (§0). Criterio: ver `roadmap.md`, Fase 2.

**Inbox (sección 2 de la spec)** — requiere API-5:
- [ ] Contador de no leídas en el header, polling (30 s propuesto, pregunta 8) + refetch al volver el foco (AC 3.10)
- [ ] Lista del inbox con mensaje, tipo con categoría visual y fecha relativa (AC 3.11, AC 3.74)
- [ ] Click → `markNotificationRead` + navegación al episodio (AC 3.12)
- [ ] "Marcar todas como leídas" (AC 3.13)
- [ ] Inbox vacío y contador ante error de consulta (AC 3.14)

**Lista `/studio` (sección 3):**
- [ ] Agrupación Requiere acción / En curso / Terminados, orden por fecha (AC 3.16)
- [ ] Fila con título truncado, etiqueta de estado, fecha y distintivo "Publicado" (AC 3.17; el distintivo requiere `publishedAt` de API-7, ver `roadmap.md` "Preguntas abiertas")
- [ ] Contador y estado vacío de "Requiere acción" (AC 3.18)
- [ ] Filtro multi-estado en la URL, tolerante a valores inválidos (AC 3.19)
- [ ] Estados vacío/carga/error (AC 3.20, AC 3.73)
- [ ] Auto-refresco mientras haya episodios "En curso" (AC 3.21)

**Crear `/studio/new` (sección 4):**
- [ ] Formulario `topic` con contador y validación 1-300 tras recortar (AC 3.22)
- [ ] Envío sin duplicados y navegación al detalle (AC 3.23, AC 3.24)
- [ ] Errores `VALIDATION_ERROR` junto al campo y genérico conservando el texto (AC 3.25)

**Detalle `/studio/episodes/[id]` (sección 5)** — requiere API-1 y API-12:
- [ ] Cabecera: tópico, estado, fecha, "Publicado", acceso al preview (AC 3.26)
- [ ] Timeline por ronda con nombre de agente y distintivo de origen (AC 3.27)
- [ ] Referencia y salto a `respondsToId` en `CROSS_EXAMINATION` (AC 3.28)
- [ ] Veredicto con juez y ganador / "Sin ganador" (AC 3.29)
- [ ] Barras de uso vs. límites, umbrales 80 %/100 %, `usage` null, `executionTime` legible (AC 3.30)
- [ ] Historial de checkpoints con motivo en español (AC 3.31)
- [ ] Bloques `FAILED`/`CANCELLED` y pantalla 404 (AC 3.40, AC 3.41)

**Vista en vivo (sección 5)** — requiere API-12 y API-13:
- [ ] Spike: la compresión no bufferea `text/event-stream` a través del rewrite (Restricciones técnicas, "Rewrites y SSE")
- [ ] Cliente SSE con `addEventListener` por tipo de evento, solo en estados "SSE" con `pipelineActive` (AC 3.32; Restricciones técnicas, "Cliente SSE")
- [ ] Feed de actividad traducido + indicador en vivo/desconectado, sin `heartbeat` en el feed (AC 3.32, AC 3.33, AC 3.37)
- [ ] Refetch del detalle por cada evento de negocio, sin reconstruir estado (AC 3.34, D7)
- [ ] Polling de 10 s en `APPROVED`/`GENERATING_AUDIO`/`RENDERING` con `pipelineActive` (AC 3.35)
- [ ] Cierre sin reintento en estados frenados/terminales (AC 3.36)
- [ ] Reconexión condicionada en `onerror` + `401` vía refetch (AC 3.38, AC 3.7)
- [ ] Mensaje de episodio trabado con `pipelineActive: false` (AC 3.39)
- [ ] Verificar: 60 s sin eventos de negocio sin reconexiones (AC 3.33)

**Curaduría en `PENDING_REVIEW` (sección 6):**
- [ ] Controles visibles solo en los estados de `api-contract.md` §5 (AC 3.42)
- [ ] Aprobar con confirmación y paso a polling hasta `READY_FOR_RENDER` (AC 3.43)
- [ ] Editor inline de un argumento a la vez (AC 3.44)
- [ ] Regenerar argumento con confirmación de los 3 avisos y estado "Regenerando…" (AC 3.45, AC 3.75)
- [ ] Deshabilitar "Regenerar" con presupuesto LLM agotado (AC 3.46)
- [ ] Rechazar con diálogo destructivo (AC 3.47)
- [ ] `409 INVALID_STATE_TRANSITION` → refetch + aviso (AC 3.48)
- [ ] Bloqueo de acciones concurrentes sobre el mismo episodio (AC 3.49)
- [ ] Errores específicos de `regenerate` (AC 3.50; mensajes específicos requieren API-10b, `404` de argumento requiere API-14)

**Resolución de `REQUIRES_HUMAN_REVIEW` (sección 7):**
- [ ] Panel de resolución con motivo, `fromState`, ronda, sobre el checkpoint más reciente (AC 3.51)
- [ ] Panel `USAGE_LIMIT_EXCEEDED`: formulario de límites > consumo actual; caso `ttsRequests` solo "Rechazar" hasta API-16 (AC 3.51)
- [ ] Panel `INSUFFICIENT_EVIDENCE`: formulario de fuentes manuales `{ url, title, snippet }` (AC 3.51)
- [ ] Panel `MAX_REVISIONS_EXCEEDED`: reanudar `{}` / rechazar (AC 3.51)
- [ ] Panel `VALIDATION_INCONSISTENCY`: agente afectado (API-1), "Reanudar" deshabilitado con explicación (AC 3.51, D13)
- [ ] Panel `PROVIDER_QUOTA_EXCEEDED`: reanudar `{}` / rechazar (AC 3.51)
- [ ] Aviso de repetición de motivo junto a "Reanudar" (AC 3.52)
- [ ] Body exacto por motivo, reapertura de SSE o polling según `fromState` (AC 3.53)
- [ ] `VALIDATION_ERROR` dentro del formulario sin perder datos (AC 3.54)
- [ ] Panel genérico para motivo desconocido (AC 3.55)
- [ ] Verificar criterio F2: crear → en vivo hasta `PENDING_REVIEW` sin cortes; forzar y resolver cada uno de los 5 motivos en local

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

## 4. F4 — Publicación y showcase público — sin empezar

Requiere §3 y API-7 (§0); preguntas 4, 7 y 10 de la spec resueltas. Criterio: ver `roadmap.md`, Fase 4.

- [ ] "Publicar" en el preview con confirmación, distintivo y enlace público (AC 3.64)
- [ ] "Despublicar" con confirmación (AC 3.65)
- [ ] `/` con `listShowcaseEpisodes`, render de servidor contra `API_INTERNAL_URL` (AC 3.66, D11)
- [ ] Showcase vacío (AC 3.71)
- [ ] `/e/[id]` con player, transcripción por segmento y veredicto (AC 3.67)
- [ ] "No encontrado" para inexistente, no publicado o fuera de `SHOWCASE_STATUSES` (AC 3.68)
- [ ] Título y transcripción en el HTML inicial + metadatos por episodio (AC 3.70)
- [ ] Caché del HTML y de respuestas con `audioUrl` acotada al TTL; renovación como en AC 3.59 (AC 3.72)
- [ ] Layout usable a 360 px (AC 3.76)
- [ ] Verificar sin sesión: ninguna respuesta de red contiene datos internos (AC 3.69); acciones con curl → `401`; despublicado → `404`

## 5. Transversales — sin empezar

Se verifican al cerrar cada fase sobre sus pantallas.

- [ ] Estados de carga/vacío/error en toda pantalla con datos (AC 3.73)
- [ ] Fechas en zona del navegador, relativas con absoluta en tooltip (AC 3.74)
- [ ] Confirmación en `reject`/`publish`/`unpublish`/`regenerate`/`regenerate-audio` y en ninguna otra (AC 3.75)
- [ ] Panel usable a 1280 px (AC 3.76)
- [ ] Teclado y foco atrapado en diálogos, verificado (AC 3.77)
- [ ] Ningún tipo de la API escrito a mano (D5) — revisión al cerrar cada fase

## Referencias

- `roadmap.md` (esta carpeta) — secuenciación, objetivo, dependencias y criterio de completitud de cada fase.
- `decision-log.md` (esta carpeta) — decisiones ya tomadas (framework, dependencias).
- `docs/product/003-dashboard-ui.md` — spec de UI (AC 3.1-3.77, API-1..API-16, plan F1-F4).
- `docs/adr/0001-auth-sesion-nest-mismo-origen.md` — auth y origen único.
- `tasks.md` de la raíz §12 — dependencias de backend de la spec 003.
