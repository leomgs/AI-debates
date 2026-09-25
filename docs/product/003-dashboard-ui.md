# 003 — Dashboard: panel de curación privado y showcase público

Estado: **especificada y revisada por `architect`** (2026-09-25), ajustada el mismo día por la spec 004 (idioma del debate) y por la decisión del usuario sobre el idioma de la interfaz del showcase (D16). No implementada. Es el documento base para desarrollar `apps/dashboard` (hoy un scaffold Next.js 16 vacío creado por la spec 002). Las decisiones marcadas **fija** las tomó el usuario y no se reabren acá. Las marcadas **decidido por defecto, revisable** son defaults razonables que se pueden cambiar sin rehacer la spec. La topología de auth está en **ADR 0001** (`docs/adr/0001-auth-sesion-nest-mismo-origen.md`); las voces por agente e idioma, en **ADR 0002** (`docs/adr/0002-voces-por-agente-e-idioma.md`). Lo que sigue sin resolverse está en "Preguntas abiertas".

Numeración: los AC y los `API-n` no se renumeran entre versiones, para que otros documentos los puedan citar. Los agregados posteriores llevan números nuevos al final (por ejemplo, AC 3.78) o un sufijo (API-7a), aunque queden dentro de otra sección.

## Contexto

El backend del MVP P0 (Features 1-8) y la reestructuración a monorepo (spec 002) están terminados. El pipeline ya corre de punta a punta hasta `READY_FOR_RENDER`: investiga, debate, juzga, se frena en `PENDING_REVIEW` para la curaduría humana, sintetiza el audio y deja listo un `RemotionManifest`. Hoy la única forma de operarlo es a mano contra la API (curl o `/docs`): crear un episodio, consultar su estado, leer los argumentos, aprobar, editar, reanudar tras una interrupción, regenerar un audio. Tampoco hay forma de mostrarle a nadie un debate terminado.

El dashboard resuelve dos problemas distintos, para dos audiencias distintas, en la misma aplicación (`apps/dashboard/docs/decision-log.md` #1, por qué Next.js):

1. **Panel de curación (privado)**: el dueño del proyecto (único usuario) necesita crear episodios (con su idioma de debate, spec 004), seguirlos en vivo, enterarse cuándo requieren su intervención, resolver esa intervención (curaduría en `PENDING_REVIEW`, resolución de `REQUIRES_HUMAN_REVIEW`, retoque del audio) y decidir qué se publica, sin conocer el contrato HTTP ni leer JSON crudo.
2. **Showcase (público)**: cualquier visitante puede ver los debates que el curador publicó, reproducidos como video, con su transcripción y su veredicto. Es la vitrina/portfolio del proyecto.

El problema real del panel **no es la falta de pantallas**, es el costo de operar el pipeline: saber qué episodio necesita atención y por qué, y resolverlo con la acción correcta sin gastar el único reintento que da el backend (una causa que se repite tras un `resume` manda el episodio a `FAILED`, `features.md` Feature 4).

## Personas

- **Curador**: el dueño del proyecto. Un solo usuario, sin roles. Conoce el dominio (fases, motivos de interrupción) pero no quiere operar la API a mano.
- **Visitante**: cualquier persona sin sesión. Solo ve episodios publicados; nunca ve datos internos (uso, límites, checkpoints, notificaciones, origen de las ediciones).

## Decisiones

Cada decisión incluye su razón. La razón es parte del contrato: una alternativa propuesta a mitad de la implementación tiene que refutar la razón, no solo ofrecer otra opción.

- **D1 — Auth de un solo usuario con sesión por cookie (fija, usuario). Resuelto en ADR 0001.** Razón: hay un único curador (proyecto personal), así que multiusuario/roles sería resolver un caso inexistente; pero el showcase público exige que la API deje de ser abierta (`api-contract.md`: "si en algún momento se expone públicamente, esto es lo primero que hay que agregar"). Proteger solo el front no alcanza: la API seguiría aceptando `approve`/`reject` de cualquiera. Cierra el gap de `apps/dashboard/docs/decision-log.md` #1. Resumen de lo que fija el ADR 0001, relevante para el producto:
  - **Nest emite y valida la sesión** (`modules/auth`: `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`). Un `SessionGuard` global **niega por defecto**; las excepciones se marcan con `@Public()`.
  - **Cookie** `httpOnly`, `SameSite=Lax`, sin `Domain`, `Secure` según el entorno. Es un token HMAC sin estado (expiración + firma) y dura **7 días**. Revocar todas las sesiones = rotar `SESSION_SECRET`.
  - **Credenciales** en `apps/api/.env`: `CURATOR_USERNAME`, `CURATOR_PASSWORD_HASH` (scrypt) y `SESSION_SECRET`, sin valores por defecto.
  - **Next es el único origen público**: reescribe `/api/:path*` y `/audio-files/:path*` hacia `API_INTERNAL_URL`. Se elimina `enableCors()`. `apps/dashboard` no tiene carpeta `app/api` (no hay backend propio en Next).
  - `src/proxy.ts` de Next 16 hace solo un **chequeo optimista** de la cookie en `/studio/*`; la autorización real es el `401` de Nest.
- **D2 — Showcase: episodios `READY_FOR_RENDER` o posteriores, reproducidos en vivo con `@remotion/player` contra el manifest (fija, usuario), y además publicados (D10).** No espera a Feature 9 (worker de render, sin arrancar); cuando exista un `.mp4` renderizado, el showcase lo usará en su lugar. Razón: hoy ningún episodio pasa de `READY_FOR_RENDER` porque no hay worker, así que un showcase limitado a `COMPLETED` estaría vacío indefinidamente; el manifest ya tiene todo lo necesario para reproducir el debate en el navegador. `SHOWCASE_STATUSES` = `READY_FOR_RENDER`, `RENDERING`, `COMPLETED`. Reemplaza la fase 4 de `apps/dashboard/docs/roadmap.md` ("episodios `COMPLETED`" + "`<video>` contra el `.mp4`").
- **D3 — Los gaps de la API se listan como dependencias de backend dentro de esta spec (fija, usuario)**, en "Cambios requeridos en la API", con la pantalla que los necesita y si son bloqueantes. Razón: el front no debe inventar datos que la API no da ni duplicar lógica de backend para derivarlos; tenerlos listados permite secuenciar el trabajo de backend sin frenar las pantallas que no dependen de ellos.
- **D4 — Stack: Tailwind (ya en el scaffold) + shadcn/ui + TanStack Query + `openapi-typescript`/`openapi-fetch` (fija, usuario).** Razón: shadcn/ui da componentes accesibles copiados al repo (sin dependencia opaca de una librería de UI); TanStack Query resuelve caché, invalidación y polling, que son justo los tres mecanismos de actualización de esta spec (D6, D7); `openapi-typescript`/`openapi-fetch` genera el cliente tipado desde `openapi.json` sin escribir tipos a mano (la razón de ser de la spec 001).
- **D5 — Los tipos de la API salen solo de `openapi.json`; `RemotionManifest` de `@ai-trend-debates/contracts`; la composición de `@ai-trend-debates/video`.** Ningún tipo de la API se duplica a mano en el dashboard. Razón: es el motivo por el que existe la spec 001 ("para que el dashboard no duplique tipos a mano y se desincronice en silencio"). Si a un tipo le falta información en `openapi.json`, el arreglo va en el backend (D3), no en un tipo local. Los docs anteriores abrevian los paquetes como `@contracts`/`@video`; los nombres reales son `@ai-trend-debates/*`.
- **D6 — SSE para la vista en vivo de un episodio; polling de `listNotifications` para el inbox.** Razón: son audiencias distintas (`decision-log.md` raíz, entrada 9). El SSE es efímero y solo sirve con la pantalla del episodio abierta; la `Notification` es un inbox persistente que tiene que funcionar aunque el curador no esté mirando ningún episodio. No se unifican ni se deduplican.
- **D7 — Tras cada acción o evento SSE se invalida la consulta del detalle (refetch); la UI no reconstruye estado a partir de los eventos.** Razón: el SSE no tiene replay/backfill (`episode-events.service.ts`) y sus payloads son parciales (por ejemplo, `argument.approved` no trae `sequenceIndex` ni `argumentId`). Reconstruir estado con eventos daría una vista que diverge de la base en cuanto se pierde uno. `getEpisodeDetail` es la única fuente de verdad; el SSE solo dispara refrescos y alimenta un feed informativo.
- **D8 — Idioma de la interfaz del panel: español.** Razón: el curador y todos los docs del proyecto están en español; los mensajes de `Notification` que genera el backend ya están en español. Esto es el idioma de la **interfaz** (etiquetas, botones, mensajes), no el del **contenido** de los debates: ese lo elige el curador por episodio (`Episode.language`, spec 004) y puede ser ES, EN o PT. El idioma de la interfaz del showcase lo define D16.
- **D9 — El panel vive bajo `/studio`; el showcase bajo un segmento de idioma (`/es`, D16).** Razón: un prefijo único hace trivial y verificable la regla "todo lo que está bajo `/studio` requiere sesión", y el segmento de idioma deja al showcase listo para sumar idiomas de interfaz sin cambiar sus URLs. La raíz del dominio (`/`) redirige al showcase.
- **D10 — Publicar es un paso explícito (fija, usuario).** Se agrega `Episode.publishedAt` y las acciones `publish`/`unpublish`, válidas desde `READY_FOR_RENDER` o posterior. El showcase muestra solo episodios con `publishedAt` no nulo **y** estado en `SHOWCASE_STATUSES`. Razón: sin este paso, un episodio aparecería en público apenas termina el audio, antes de que el curador escuche el preview; y el curador no tendría forma de sacar del showcase un episodio que no quiere mostrar. `regenerate-audio` sigue permitido sobre un episodio publicado (cambia lo que oye el público) y la UI lo avisa. **Secuencia (fija, usuario)**: el campo `publishedAt` y su exposición en detalle y listado se adelantan a F2 (API-7a); las acciones `publish`/`unpublish` y los endpoints `/showcase` quedan en F4 (API-7).
- **D11 — Cómo habla el dashboard con la API.** En el navegador, `openapi-fetch` usa `baseUrl` `/api` (mismo origen, D1). En el render de servidor del showcase usa `API_INTERNAL_URL`. El panel pide sus datos **del lado del cliente**; el servidor de Next **nunca reenvía cookies** a la API. Razón: así la única credencial que circula es la cookie del navegador hacia el mismo origen, y el servidor de Next nunca actúa en nombre del curador (no hay forma de que un render de servidor filtre datos privados).
- **D12 — TTL de las URLs de audio en producción: 3600 s (decidido por defecto, revisable).** Razón: el default de 300 s obliga a renovar URLs en medio de una reproducción normal; 3600 s cubre un episodio completo con margen. La renovación ante un fallo (AC 3.59) queda como respaldo, no como camino normal.
- **D13 — `VALIDATION_INCONSISTENCY`: "Reanudar" deshabilitado con explicación; solo "Rechazar" (decidido por defecto, revisable).** Razón (verificada por `architect`): `resume {}` vuelve a lanzar la misma excepción en `pickCrossExaminationTarget` y el episodio pasa a `FAILED` de forma determinista. Ofrecer "Reanudar" sería ofrecer un botón que solo sirve para romper el episodio. Con las rondas por defecto, el caso es prácticamente inalcanzable.
- **D14 — Sin modo degradado para los nombres de agentes; se espera API-1 (decidido por defecto, revisable).** Razón: `getManifest` ya carga los participantes, así que exponerlos en el detalle es un cambio chico de backend; etiquetas provisorias tipo "Agente 1" crearían una UI que después hay que desarmar.
- **D15 — Idioma del debate: se elige al crear y no se cambia (fija, usuario; spec 004).** `Episode.language` es un enum `DebateLanguage` (`ES` | `EN` | `PT`), con default `ES` (español neutro latinoamericano) e inmutable. El formulario de creación ofrece el selector; el resto del panel y el showcase solo lo muestran. Razón: el idioma condiciona la investigación, los argumentos y las voces TTS de todo el episodio (spec 004, ADR 0002); cambiarlo a mitad de camino dejaría contenido y audio mezclados. Para otro idioma, se crea otro episodio.
- **D16 — Interfaz del showcase: un solo idioma (español) en F4, con rutas preparadas para i18n desde el día uno.**
  - **Objetivo (fija, usuario)**: i18n completo de la interfaz del showcase, con rutas `/es`, `/en` y `/pt` y un selector de idioma. Es independiente del idioma del contenido de cada debate (D15): un debate en inglés se puede ver con la interfaz en español y al revés. **Es nice-to-have y no entra en F4** (fija, usuario).
  - **Forma de las rutas en F4 (decidido por defecto, revisable)**: el showcase vive desde el primer día bajo un segmento `[locale]`, con `es` como único valor válido: `/es` (lista) y `/es/e/[id]` (detalle). `/` redirige a `/es` con una redirección **temporal** (307). Cualquier otro valor del segmento responde 404. Sumar `en` y `pt` después es agregar valores válidos y diccionarios; ninguna URL existente cambia.
  - **Razón de la forma elegida**: todo link que se comparta desde el día uno ya lleva el idioma (`/es/e/[id]`) y sigue siendo válido cuando se sumen `/en` y `/pt`. Se descartó la alternativa de publicar `/e/[id]` sin idioma y moverla más tarde a `/[locale]/e/[id]` con una redirección permanente: obliga a mantener esa redirección para siempre y no deja decidir a qué idioma debe ir un link viejo. La redirección de `/` es temporal (y no permanente) porque, cuando haya varios idiomas, `/` va a elegir el destino según el navegador del visitante; una 308 quedaría cacheada apuntando siempre a `/es`.

## No-objetivos

Fuera de alcance. Si algo de esto parece necesario, parar y preguntar:

- **UI de auditoría completa (Feature 10, P1)**: prompts, drafts rechazados, desglose de fact-checks, `ArgumentHistory` completo. Solo se deja lugar para mostrarlos cuando la API los exponga (nice-to-have).
- **Worker de render (Feature 9 backend)** y el botón "renderizar": el dashboard no dispara renders.
- **Streaming palabra por palabra**: el SSE del MVP emite bloques consolidados (`features.md` Feature 8).
- **Multiusuario, roles, registro, recuperación de contraseña**, revocación de una sesión puntual (solo se revocan todas, rotando `SESSION_SECRET`).
- **Themes de video nuevos, personas/rigs, rediseño de la composición**: se usa el theme que exista en `packages/video` (hoy uno solo, placeholder).
- **Edición de otros parámetros del episodio al crearlo** (rondas, límites, proveedores): `createEpisode` acepta solo `topic` y `language` (spec 004).
- **Cambiar el idioma de un episodio existente** (D15).
- **Gestión de voces TTS desde el dashboard**: las voces por agente e idioma se configuran en el seed de la API (ADR 0002); el panel solo informa cuando faltan.
- **Interfaz del showcase en inglés o portugués** (`/en`, `/pt`, selector de idioma): nice-to-have, fuera de F4 (D16).
- **Interfaz del panel en otro idioma que no sea español** (D8).
- **Ingesta automática de trends**: el tópico se ingresa a mano (Feature 1).
- **Cambiar comportamiento del pipeline** (reglas de transición, límites por defecto, criterio de `FAILED`, recuperación de episodios trabados). Si la UI descubre que una regla del backend es mala para el curador, se anota como pregunta, no se "arregla" desde el front.
- **Backend propio en Next** (`app/api`, route handlers que hablen con la base): prohibido por ADR 0001.

## Mapa de rutas

| Ruta | Superficie | Sesión | Propósito |
|---|---|---|---|
| `/` | — | No | Redirección temporal (307) a `/es` (D16) |
| `/es` | Showcase | No | Lista de episodios publicados |
| `/es/e/[id]` | Showcase | No | Player + transcripción + veredicto de un episodio publicado |
| `/login` | Panel | No | Formulario de login del curador |
| `/studio` | Panel | Sí | Lista de episodios agrupada por "requiere acción" |
| `/studio/new` | Panel | Sí | Crear episodio |
| `/studio/episodes/[id]` | Panel | Sí | Detalle, acciones de curaduría y vista en vivo |
| `/studio/episodes/[id]/preview` | Panel | Sí | Player contra el manifest, regenerar audio, publicar/despublicar |
| (header del panel) | Panel | Sí | Inbox de notificaciones, presente en todas las rutas `/studio/*` |

En este documento, "`/[locale]`" y "`/[locale]/e/[id]`" se refieren a las rutas del showcase en general; en F4 el único `locale` válido es `es`. `/api/*` y `/audio-files/*` no son rutas del dashboard: son rewrites hacia la API (D1).

## Mapeo de estados a UI

Los 14 valores de `EpisodeStatus` (`openapi.json`). "Categoría" define el tratamiento visual (color semántico, no un color concreto): neutral, en curso, atención, listo, cancelado, error. "Actualización" indica cómo se entera la pantalla de detalle de un cambio: SSE (con refetch, D7) o polling del detalle, porque en esas fases no hay eventos SSE. Tanto el SSE como el polling solo corren si además `pipelineActive` es `true` (API-12); si es `false` en un estado activo, el episodio está trabado (AC 3.39).

| Status | Etiqueta | Categoría | Grupo en `/studio` | Terminal | Acciones que aplican | Actualización | En showcase si está publicado |
|---|---|---|---|---|---|---|---|
| `CREATED` | Creado | neutral | En curso | No | — | SSE | No |
| `RESEARCHING` | Investigando | en curso | En curso | No | — | SSE | No |
| `READY_FOR_DEBATE` | Listo para debatir | en curso | En curso | No | — | SSE | No |
| `DEBATING` | Debatiendo | en curso | En curso | No | — | SSE | No |
| `JUDGING` | Juzgando | en curso | En curso | No | — | SSE | No |
| `PENDING_REVIEW` | Esperando revisión | atención | Requiere acción | No | `approve`, `edit`, `regenerate`, `reject` | Ninguna (el pipeline está frenado) | No |
| `REQUIRES_HUMAN_REVIEW` | Requiere intervención | atención | Requiere acción | No | `resume`, `reject` | Ninguna (el pipeline está frenado) | No |
| `APPROVED` | Aprobado | en curso | En curso | No | — | Polling | No |
| `GENERATING_AUDIO` | Generando audio | en curso | En curso | No | — | Polling | No |
| `READY_FOR_RENDER` | Listo | listo | Terminados | No (en la práctica sí, hasta Feature 9) | `regenerate-audio`, `publish`/`unpublish`, preview | Ninguna | Sí |
| `RENDERING` | Renderizando | en curso | En curso | No | `publish`/`unpublish`, preview | Polling | Sí |
| `COMPLETED` | Completado | listo | Terminados | Sí | `publish`/`unpublish`, preview | Ninguna | Sí |
| `CANCELLED` | Cancelado | cancelado | Terminados | Sí | — | Ninguna | No |
| `FAILED` | Falló | error | Terminados | Sí | — | Ninguna | No |

`RENDERING` y `COMPLETED` no son alcanzables hoy (Feature 9 no existe); se mapean igual para que la UI no se rompa el día que aparezcan. Las acciones y sus estados de origen son los de `api-contract.md` §5, más `publish`/`unpublish` (D10, API-7). Cualquier otra combinación la rechaza el backend con `409 INVALID_STATE_TRANSITION`.

Etiquetas del idioma del debate (`DebateLanguage`), usadas en el selector y en los distintivos: `ES` → "Español", `EN` → "English", `PT` → "Português". En el distintivo compacto puede usarse el código (`ES`/`EN`/`PT`) con el nombre completo accesible (por ejemplo, en un tooltip).

## Pantallas, user stories y criterios de aceptación

Los AC se numeran `AC 3.x` en toda la spec (el 3 es el número de la spec). "Error genérico" significa: mensaje legible con el `error.message` del envelope `{ error: { code, message } }` de `api-contract.md` §1, y opción de reintentar; nunca un JSON crudo ni una pantalla en blanco.

### 1. Autenticación

- **US 1.1** — Como curador, quiero iniciar sesión con mi credencial, para que solo yo pueda operar el pipeline.
- **US 1.2** — Como curador, quiero que la sesión persista entre recargas, para no loguearme cada vez que abro el panel.
- **US 1.3** — Como curador, quiero cerrar sesión, para no dejar el panel abierto en un equipo ajeno.

Datos: `POST /auth/login`, `POST /auth/logout`, `GET /auth/session` (API-8, ADR 0001).

- **AC 3.1** — Acceder a cualquier ruta `/studio/*` sin sesión redirige a `/login?next=<ruta>`. Tras un login exitoso se vuelve a `next` **solo si es una ruta relativa que empieza con `/studio/`**; cualquier otro valor (URL absoluta, `//dominio`, otra ruta) lleva a `/studio`. Esto evita un open redirect.
- **AC 3.2** — Una credencial incorrecta muestra un error en el formulario, sin indicar cuál de los dos campos falló, y no crea sesión.
- **AC 3.3** — Con sesión válida, recargar cualquier ruta `/studio/*` no pide login de nuevo durante 7 días desde el login. Pasado ese plazo, la siguiente navegación o consulta lleva a `/login`.
- **AC 3.4** — "Cerrar sesión" llama a `POST /auth/logout`; la siguiente navegación a `/studio/*` desde ese navegador redirige a `/login`.
- **AC 3.5** — Cualquier endpoint de la API no marcado como público, pedido sin sesión válida (incluidas las acciones y el stream SSE), devuelve `401` con `code: UNAUTHORIZED`. Verificable con curl contra el origen de Next (`/api/...`).
- **AC 3.6** — Las rutas del showcase (`/`, `/[locale]`, `/[locale]/e/[id]`) funcionan sin sesión y no muestran ningún control ni enlace del panel.
- **AC 3.7** — Si la sesión vence mientras el curador está en el panel, la siguiente consulta o acción que reciba un `401` lo lleva a `/login?next=<ruta actual>`, y se le informa que la acción no se ejecutó.
- **AC 3.8** — Si el backend rechaza el login por exceso de intentos (rate-limit de API-8), el formulario muestra un mensaje específico ("Demasiados intentos, esperá unos minutos"), distinto del de credencial incorrecta.
- **AC 3.9** — Todas las requests del navegador van al mismo origen del dashboard (`/api/...`, `/audio-files/...`); la URL interna de la API nunca aparece en el navegador. Verificable en la pestaña de red.

### 2. Layout del panel e inbox de notificaciones

- **US 2.1** — Como curador, quiero ver en cualquier pantalla del panel cuántas notificaciones sin leer tengo, para enterarme de que un episodio necesita atención sin tener que buscarlo.
- **US 2.2** — Como curador, quiero abrir una notificación y llegar directo al episodio, para resolver lo que la originó.
- **US 2.3** — Como curador, quiero marcar una o todas como leídas, para limpiar el inbox.

Datos: `listNotifications` (`unreadOnly=true` para el contador, `unreadOnly=false` para el historial), `markNotificationRead`, `markAllNotificationsRead`. Tipos de notificación que emite el backend: `EPISODE_COMPLETED`, `EPISODE_PENDING_REVIEW`, `EPISODE_REQUIRES_REVIEW`, `EPISODE_FAILED` (el mensaje en español ya viene armado del backend).

- **AC 3.10** — El header de todas las rutas `/studio/*` muestra el número de notificaciones sin leer. Se actualiza por polling sin recargar la página (intervalo propuesto: 30 s, pregunta 8) y también al volver el foco a la pestaña.
- **AC 3.11** — Abrir el inbox lista las notificaciones con su mensaje, tipo (con el mismo tratamiento visual que la categoría del estado relacionado) y fecha relativa, de más nueva a más vieja.
- **AC 3.12** — Hacer click en una notificación la marca como leída (`markNotificationRead`) y navega a `/studio/episodes/[episodeId]`.
- **AC 3.13** — "Marcar todas como leídas" (`markAllNotificationsRead`) deja el contador en 0 sin recargar.
- **AC 3.14** — Inbox vacío: mensaje explícito ("No hay notificaciones"), no una lista en blanco. Si la consulta falla, el contador no muestra un número falso (se oculta o muestra un indicador de error) y el resto del panel sigue funcionando.
- **AC 3.15** — El panel tiene navegación visible a: lista de episodios, crear episodio, ver el showcase público (`/es`), cerrar sesión.

### 3. Lista de episodios (`/studio`)

- **US 3.1** — Como curador, quiero ver primero los episodios que requieren mi acción, para no revisar todos buscando cuál está frenado.
- **US 3.2** — Como curador, quiero filtrar por estado, para encontrar rápido un episodio concreto.

Datos: `listEpisodes` (`EpisodeListItemDto`: `id`, `status`, `title`, `createdAt`; más `publishedAt` de API-7a y `language` de API-1), con `status` como filtro CSV (`api-contract.md` §2).

- **AC 3.16** — La lista se agrupa en tres secciones, en este orden: **Requiere acción** (`PENDING_REVIEW`, `REQUIRES_HUMAN_REVIEW`), **En curso** y **Terminados** (según la columna "Grupo" del mapeo de estados). Dentro de cada grupo, de más nuevo a más viejo.
- **AC 3.17** — Cada fila muestra el título (el tópico), un distintivo con el idioma del debate, la etiqueta de estado con su categoría visual, la fecha de creación y, si `publishedAt` no es nulo, un distintivo "Publicado". Toda la fila navega al detalle. (Mientras no existan las acciones de publicación de API-7, el distintivo "Publicado" se verifica poniendo `publishedAt` a mano en la base.)
- **AC 3.18** — La sección "Requiere acción" muestra un contador y se destaca visualmente; si está vacía, lo dice ("Nada pendiente") en vez de ocultarse.
- **AC 3.19** — Un filtro por estado (selección múltiple sobre los 14 valores) reduce la lista usando el parámetro `status` de `listEpisodes`. El filtro activo queda en la URL (se puede compartir y recargar). Un valor inválido en la URL se ignora, no rompe la pantalla.
- **AC 3.20** — Sin episodios: mensaje con acceso directo a "Crear episodio". Mientras carga: placeholder de la lista, no un spinner a pantalla completa. Si falla: error genérico con reintentar.
- **AC 3.21** — La lista se refresca sola mientras haya algún episodio en el grupo "En curso" (mismo intervalo que el polling del detalle), para que un episodio que pasa a `PENDING_REVIEW` suba a "Requiere acción" sin recargar.

### 4. Crear episodio (`/studio/new`)

- **US 4.1** — Como curador, quiero crear un episodio a partir de un tópico y seguir su progreso en vivo enseguida, para no tener que buscarlo después.
- **US 4.2** — Como curador, quiero elegir en qué idioma se debate el episodio, para producir contenido para distintas audiencias.

Datos: `createEpisode` (`CreateEpisodeDto`: `topic`, 1-300 caracteres; `language`, `ES` | `EN` | `PT`, default `ES`; spec 004, API-17).

- **AC 3.22** — El formulario tiene el campo `topic` y un selector de idioma del debate con las tres opciones (Español, English, Português), con Español preseleccionado. Junto al selector, una nota aclara que el idioma no se puede cambiar después de crear el episodio. El botón de enviar se deshabilita si `topic` está vacío (tras recortar espacios) o supera 300 caracteres; hay un contador de caracteres visible.
- **AC 3.23** — Al enviar, el botón queda deshabilitado hasta la respuesta (no se crean episodios duplicados por doble click).
- **AC 3.24** — Con `201`, se navega a `/studio/episodes/[id]` y esa pantalla queda suscripta a los eventos en vivo.
- **AC 3.25** — Un `400 VALIDATION_ERROR` se muestra junto al campo correspondiente con el mensaje del backend. Cualquier otro error no contemplado en AC 3.78: error genérico, conservando el texto y el idioma elegidos.
- **AC 3.78** — Un `409 VOICE_NOT_CONFIGURED` (el idioma elegido no tiene voces configuradas para el proveedor de audio activo, ADR 0002) no crea el episodio y muestra, junto al selector de idioma: "No hay voces configuradas para <idioma> en el proveedor de audio activo. Configuralas en el seed de la API o elegí otro idioma", más el `error.message` del backend si trae detalle. Se conservan el texto y el idioma elegidos.

### 5. Detalle de episodio y vista en vivo (`/studio/episodes/[id]`)

- **US 5.1** — Como curador, quiero ver el debate completo de un episodio (rondas, argumentos, veredicto), para evaluar su calidad.
- **US 5.2** — Como curador, quiero ver en vivo lo que está pasando mientras el pipeline corre, para saber que avanza y en qué fase está.
- **US 5.3** — Como curador, quiero ver cuánto presupuesto consumió el episodio contra sus límites, para anticipar un `USAGE_LIMIT_EXCEEDED`.
- **US 5.4** — Como curador, quiero ver el historial de interrupciones del episodio, para entender por qué se frenó antes y qué pasa si vuelve a frenarse por lo mismo.
- **US 5.5** — Como curador, quiero saber si un episodio está trabado y no va a avanzar solo, para no quedarme esperando.

Datos: `getEpisodeDetail` (`status`, `usage` nullable, `limits`, `checkpoints[]`, `debate.rounds[].arguments[]`, `debate.verdict`; más tópico, `createdAt`, `language` y participantes de API-1, `pipelineActive` de API-12 y `publishedAt` de API-7a), `streamEpisodeEvents`.

- **AC 3.26** — Cabecera: tópico del episodio, distintivo con el idioma del debate, etiqueta de estado, fecha de creación, distintivo "Publicado" si `publishedAt` no es nulo y, desde `READY_FOR_RENDER`, acceso al preview.
- **AC 3.27** — Timeline del debate: una sección por ronda en orden de `round`, con su tipo en español ("Apertura" para `OPENING`, "Réplica" para `REBUTTAL`, "Contrainterrogatorio" para `CROSS_EXAMINATION`). Cada argumento muestra el nombre del agente que lo dijo (participante de API-1), su contenido completo y un distintivo de origen: "IA" (`AI_GENERATED`) o "Editado por humano" (`HUMAN_EDITED`).
- **AC 3.28** — En `CROSS_EXAMINATION`, cada argumento con `respondsToId` muestra a qué argumento responde (agente + extracto) y permite saltar a él dentro de la misma página.
- **AC 3.29** — Si existe `verdict`, se muestra al final: nombre del juez (el participante con `isJudge`), su texto, y el ganador (nombre del agente de `winnerId`) o "Sin ganador" si `winnerId` es null.
- **AC 3.30** — Uso vs. límites: tres barras (llamadas LLM `llmCalls`/`maxLlmCalls`, búsquedas `searchRequests`/`maxSearchQueries`, segmentos TTS `ttsRequests`/`maxTtsSegments`) con el valor numérico. Una barra al 80 % o más se marca "cerca del límite" y al 100 % "límite alcanzado". Con `usage` null se muestra "Sin consumo registrado", no ceros inventados. El tiempo de ejecución (`executionTime`) se muestra legible (min/s).
- **AC 3.31** — Historial de checkpoints: lista cronológica con el motivo (en español, ver sección 7), la fase desde la que se interrumpió (`fromState`), la ronda si `debateRoundId` no es null, y la fecha. Sin checkpoints: "Sin interrupciones".
- **AC 3.32** — Vista en vivo: mientras el estado tenga "SSE" en el mapeo de estados y `pipelineActive` sea `true`, la pantalla está suscripta a `streamEpisodeEvents` y muestra un feed de actividad con cada evento traducido a una línea legible: `research.started` ("Empezó la investigación"), `agent.thinking` ("<agente> está preparando su argumento de la ronda N"), `fact_check.completed` ("Fact-check: aprobado" / "Fact-check: N errores detectados"), `argument.approved` ("Nuevo argumento de <agente>"), `episode.pending_review`, `episode.requires_review` (con el motivo). Hay un indicador visible de "en vivo" / "desconectado".
- **AC 3.33** — La conexión en vivo sobrevive a períodos sin actividad: un episodio que pasa 60 s o más sin emitir eventos de negocio sigue "en vivo" sin reconexiones (lo sostiene el `heartbeat` de API-13). El `heartbeat` no aparece en el feed.
- **AC 3.34** — Cada evento SSE de negocio dispara un refresco del detalle (D7): un `argument.approved` hace aparecer el argumento en el timeline desde la respuesta de `getEpisodeDetail`, no desde el payload del evento.
- **AC 3.35** — En estados con "Polling" (`APPROVED`, `GENERATING_AUDIO`, `RENDERING`) y `pipelineActive` en `true`, el detalle se refresca periódicamente (intervalo propuesto: 10 s, pregunta 8) y deja de hacerlo al llegar a un estado sin actualización.
- **AC 3.36** — Al llegar a un estado frenado o terminal (`PENDING_REVIEW`, `REQUIRES_HUMAN_REVIEW`, `READY_FOR_RENDER`, `COMPLETED`, `CANCELLED`, `FAILED`), la suscripción SSE se cierra y no se reintenta.
- **AC 3.37** — Al abrir la pantalla de un episodio que ya está corriendo, se muestra su estado actual completo (desde `getEpisodeDetail`) aunque el feed arranque vacío; el feed aclara que solo muestra la actividad desde que se abrió la pantalla.
- **AC 3.38** — Si la conexión SSE falla o se corta, la UI la cierra, refresca el detalle y reconecta **solo** si el estado sigue siendo de tipo "SSE" y `pipelineActive` sigue en `true`; mientras tanto muestra "desconectado". Si ese refresco devuelve `401`, se aplica AC 3.7.
- **AC 3.39** — **Episodio trabado**: si el estado es activo (cualquiera con "SSE" o "Polling" en el mapeo) y `pipelineActive` es `false`, la pantalla muestra "Detenido por un error interno; se retomará al reiniciar el backend", sin feed en vivo, sin SSE y sin polling.
- **AC 3.40** — `FAILED`: se muestra un bloque de error con el motivo del último checkpoint (siempre existe: `markFailed` siempre crea uno). `CANCELLED`: se indica que lo rechazó el curador.
- **AC 3.41** — ID inexistente (`404 NOT_FOUND`): pantalla "Episodio no encontrado" con vuelta a la lista.

### 6. Curaduría en `PENDING_REVIEW`

- **US 6.1** — Como curador, quiero aprobar un episodio cuando el debate me convence, para que siga a la generación de audio.
- **US 6.2** — Como curador, quiero corregir el texto de un argumento puntual, para arreglar un error sin rehacer el debate.
- **US 6.3** — Como curador, quiero pedirle al agente que reescriba un argumento puntual, para descartar uno flojo sin escribirlo yo.
- **US 6.4** — Como curador, quiero rechazar un episodio que no vale la pena, sabiendo que no se puede deshacer.

Datos: `runEpisodeAction` con `action` = `approve` (sin body), `edit` (`{ argumentId, content }`), `regenerate` (`{ argumentId }`), `reject` (sin body).

- **AC 3.42** — Los controles de curaduría solo se muestran cuando el estado es `PENDING_REVIEW` (y `reject` también en `REQUIRES_HUMAN_REVIEW`), según `api-contract.md` §5. En cualquier otro estado no aparecen (no alcanza con deshabilitarlos).
- **AC 3.43** — Aprobar: botón primario con confirmación breve. Tras el éxito, el estado pasa a `APPROVED` y la pantalla empieza a refrescarse por polling (AC 3.35) hasta `READY_FOR_RENDER`; en ese momento ofrece ir al preview.
- **AC 3.44** — Editar: cada argumento tiene "Editar", que lo convierte en un editor inline con el texto actual. "Guardar" se deshabilita si el texto queda vacío o igual al original; "Cancelar" con cambios sin guardar pide confirmación. Tras guardar, el argumento lleva el distintivo "Editado por humano". Solo un argumento puede estar en edición a la vez.
- **AC 3.45** — Regenerar: cada argumento tiene "Regenerar", con una confirmación que avisa que (a) reemplaza el texto actual, (b) consume una llamada LLM del presupuesto del episodio y (c) el texto nuevo **no pasa por el fact-checker** (comportamiento real de `regenerate`). Mientras corre, ese argumento muestra "Regenerando…" con sus controles deshabilitados; el resto de la pantalla sigue usable. Al terminar se ve el texto nuevo, con origen "IA".
- **AC 3.46** — "Regenerar" se deshabilita, con la explicación a la vista, si `usage.llmCalls >= limits.maxLlmCalls`: en `PENDING_REVIEW` no hay forma de subir los límites, así que la llamada fallaría seguro.
- **AC 3.47** — Rechazar: acción destructiva, visualmente separada de "Aprobar", con un diálogo de confirmación que explica que el episodio pasa a `CANCELLED` y no se puede deshacer.
- **AC 3.48** — Un `409 INVALID_STATE_TRANSITION` en cualquier acción refresca el detalle y muestra un aviso ("El episodio cambió de estado; se actualizó la vista") en vez de un error genérico.
- **AC 3.49** — Mientras una acción está en curso, no se puede disparar otra sobre el mismo episodio (evita dobles envíos y carreras entre `approve` y `edit`).
- **AC 3.50** — Errores específicos de `regenerate` (API-10b): `409 USAGE_LIMIT_EXCEEDED` → "Se agotó el presupuesto de llamadas LLM del episodio"; `503 PROVIDER_QUOTA_EXCEEDED` → "El proveedor de IA no está disponible o agotó su cuota; probá más tarde". Un `404 NOT_FOUND` sobre el argumento (API-14) refresca el detalle. Cualquier otro error: error genérico. En todos los casos el argumento queda como estaba.

### 7. Resolución de `REQUIRES_HUMAN_REVIEW`

- **US 7.1** — Como curador, quiero entender en términos concretos por qué se frenó un episodio, para decidir si vale la pena reanudarlo.
- **US 7.2** — Como curador, quiero que la pantalla me pida exactamente lo que el backend necesita para reanudar según el motivo, para no mandar un body equivocado.
- **US 7.3** — Como curador, quiero saber antes de reanudar que, si se repite la misma causa, el episodio falla definitivamente, para no gastar el reintento a ciegas.

Datos: el checkpoint activo es el **más reciente** de `checkpoints[]` (mismo criterio que usa `resume` en el backend: `orderBy createdAt desc`). `runEpisodeAction` con `resume` (body según motivo) o `reject`.

- **AC 3.51** — Con estado `REQUIRES_HUMAN_REVIEW`, el detalle muestra arriba de todo un panel de resolución con: el motivo en lenguaje claro, la fase donde se frenó (`fromState`), la ronda si aplica, y las acciones disponibles para ese motivo. Hay un panel distinto para cada uno de los **6 motivos**:

| Motivo (`reason`) | Qué explica la UI | Qué pide / permite |
|---|---|---|
| `USAGE_LIMIT_EXCEEDED` | Se agotó el presupuesto propio del episodio. Indica qué métrica llegó al límite, comparando `usage` con `limits`. | Formulario para subir `maxLlmCalls` y/o `maxSearchQueries` (y `maxTtsSegments` cuando exista API-16): al menos uno, enteros positivos, precargados con el valor actual y validados como mayores que el consumo actual. Luego "Reanudar". También "Rechazar". **Mientras no exista API-16**, si la métrica agotada es `ttsRequests`, el panel lo explica y ofrece solo "Rechazar". |
| `INSUFFICIENT_EVIDENCE` | La investigación encontró menos de 3 fuentes válidas. | Formulario de fuentes manuales: 1 o más ítems `{ url, title, snippet }`, los tres obligatorios, con `url` válida; se pueden agregar y quitar filas. Luego "Reanudar". También "Rechazar". |
| `MAX_REVISIONS_EXCEEDED` | Un agente agotó sus intentos de revisión en el fact-checking. | "Reanudar" (body `{}`) o "Rechazar". |
| `VALIDATION_INCONSISTENCY` | Caso conocido (`frontend-notes.md` 2026-09-08): un agente llega al contrainterrogatorio sin ningún argumento aprobado propio al que responder. Muestra el agente afectado, derivado de los participantes (API-1) y los argumentos de la ronda. Explica que reanudar vuelve a producir el mismo error y manda el episodio a "Falló" (D13). | "Reanudar" visible pero **deshabilitado**, con esa explicación. Solo "Rechazar". |
| `PROVIDER_QUOTA_EXCEEDED` | Se agotó la cuota del **proveedor externo** (LLM) o el proveedor de TTS no está disponible; no es el presupuesto del episodio, así que subir límites no sirve. La cuota diaria del LLM se mide en una ventana deslizante de 24 h. | "Reanudar" (body `{}`), cuando el curador estime que el proveedor se recuperó. También "Rechazar". |
| `VOICE_NOT_CONFIGURED` | Falta al menos una voz TTS para el idioma del episodio en el proveedor de audio activo (ADR 0002). Indica el idioma (`language` del episodio) y los agentes sin voz (API-18); mientras API-18 no exista, lista los participantes del episodio (API-1) como los agentes a revisar. Explica que la corrección se hace en el seed de las voces de la API, fuera del dashboard, y que a diferencia de `VALIDATION_INCONSISTENCY` acá reanudar sí resuelve, si antes se corrigieron las voces. | "Reanudar" (body `{}`) **habilitado**, o "Rechazar". |

- **AC 3.52** — Junto a todo botón "Reanudar" habilitado se muestra: "Si tras reanudar vuelve a ocurrir este mismo motivo, en cualquier fase, antes de que ocurra un motivo distinto, el episodio pasa a Falló y no se puede recuperar". En `PROVIDER_QUOTA_EXCEEDED` se agrega que reanudar antes de que se recupere el proveedor gasta ese único reintento; en `VOICE_NOT_CONFIGURED`, que reanudar sin haber corregido las voces lo gasta igual.
- **AC 3.53** — "Reanudar" manda exactamente el body que corresponde al motivo del checkpoint activo (`api-contract.md` §3), y los formularios no dejan enviar hasta ser válidos. Tras el éxito, el estado vuelve a la fase activa, se reabre la suscripción SSE (o el polling, si `fromState` es `GENERATING_AUDIO`) y el panel de resolución desaparece.
- **AC 3.54** — Un `400 VALIDATION_ERROR` al reanudar se muestra dentro del formulario con el mensaje del backend, sin perder lo cargado.
- **AC 3.55** — Un motivo desconocido (un valor futuro no contemplado) muestra un panel genérico con el código crudo y solo "Rechazar", en vez de romper la pantalla.

### 8. Preview del video y publicación (`/studio/episodes/[id]/preview`)

- **US 8.1** — Como curador, quiero ver y escuchar el episodio como va a quedar antes de publicarlo, para detectar un audio mal sintetizado.
- **US 8.2** — Como curador, quiero regenerar el audio de un segmento puntual sin tocar el resto.
- **US 8.3** — Como curador, quiero decidir cuándo un episodio aparece en el showcase y poder sacarlo, para mostrar solo lo que me convence.

Datos: `getEpisodeManifest` (`RemotionManifest`: `meta.topic`, `meta.language`, `meta.durationEstimatedSec`, `agents[]` con `name`, `timeline[]` con `sequenceIndex`, `agentId`, `text`, `audioUrl` opcional, `durationMs`, `subtitles`; `verdict`), `getEpisodeDetail` (para `usage`/`limits`/`publishedAt`), `runEpisodeAction` con `regenerate-audio` (`{ sequenceIndex }`), `publish` y `unpublish` (API-7). Composición de `@ai-trend-debates/video`.

- **AC 3.56** — Con estado `READY_FOR_RENDER` o posterior, la pantalla muestra el player reproduciendo la composición del manifest **con audio**, con play/pausa, barra de progreso y salto a un segmento.
- **AC 3.57** — Debajo del player, la lista de segmentos del `timeline` (índice, nombre del agente desde `manifest.agents`, texto, duración). Click en un segmento lleva el player a ese punto.
- **AC 3.58** — `409 MANIFEST_NOT_READY` (o un estado anterior a `READY_FOR_RENDER`): estado vacío que explica que el video estará disponible cuando termine la generación de audio, con vuelta al detalle. No es un error.
- **AC 3.59** — Respaldo ante URLs vencidas (en producción el TTL es de 3600 s, D12): si un audio falla al cargar (por ejemplo, `403 FORBIDDEN` por vencimiento), se vuelve a pedir el manifest y la reproducción sigue desde donde estaba, sin intervención del curador. Verificable con un TTL corto en local (por ejemplo, 60 s) dejando el preview abierto más tiempo que el TTL y reproduciendo.
- **AC 3.60** — "Regenerar audio" por segmento (solo en `READY_FOR_RENDER`), con una confirmación que avisa que consume un segmento TTS del presupuesto y, **si el episodio está publicado**, que el cambio se ve en el showcase en cuanto termine. Mientras corre, el segmento muestra "Regenerando…". Al terminar se vuelve a pedir el manifest, el segmento suena con el audio nuevo y la duración total se actualiza si cambió.
- **AC 3.61** — "Regenerar audio" se deshabilita, con la explicación a la vista, si `usage.ttsRequests >= limits.maxTtsSegments`: en `READY_FOR_RENDER` no hay forma de subir los límites.
- **AC 3.62** — Errores al regenerar audio: `400 INVALID_SEQUENCE_INDEX` o `409 INVALID_STATE_TRANSITION` refrescan el manifest y muestran un aviso; `409 USAGE_LIMIT_EXCEEDED` y `503 PROVIDER_QUOTA_EXCEEDED` (API-10b) se muestran con mensajes específicos, como en AC 3.50. Ningún segmento queda en "Regenerando…" indefinidamente.
- **AC 3.63** — Un segmento sin `audioUrl` (el campo es opcional en el contrato) no rompe el player: se reproduce sin sonido durante su duración y queda marcado "sin audio" en la lista de segmentos.
- **AC 3.64** — Publicar: con estado en `SHOWCASE_STATUSES` y el episodio no publicado, el preview ofrece "Publicar", con una confirmación que explica que el episodio queda visible para cualquiera en el showcase (`/es` y `/es/e/[id]`). Tras el éxito se ve el distintivo "Publicado" y un enlace a su página pública (`/es/e/[id]`).
- **AC 3.65** — Despublicar: con el episodio publicado, el preview ofrece "Despublicar", con confirmación. Tras el éxito deja de aparecer en `/[locale]` y `/[locale]/e/[id]` responde "no encontrado" (sujeto solo al TTL de caché de AC 3.72).

### 9. Showcase público (`/[locale]` y `/[locale]/e/[id]`; en F4, solo `/es`)

- **US 9.1** — Como visitante, quiero ver la lista de debates publicados, para elegir cuál mirar.
- **US 9.2** — Como visitante, quiero ver un debate como video, con su transcripción y veredicto, para entenderlo aunque no pueda escuchar el audio.
- **US 9.3** — Como curador, quiero que el showcase se pueda compartir por link y se indexe, para usarlo como portfolio.
- **US 9.4** — Como curador, quiero que los links del showcase que comparto hoy sigan funcionando cuando la interfaz tenga más idiomas.

Datos (API-7, públicos): `listShowcaseEpisodes` (`GET /showcase/episodes` → `{ id, title, createdAt, durationSec, language }[]`), `getShowcaseEpisode` (`GET /showcase/episodes/:id` → `{ id, title, createdAt, manifest }`; el idioma del debate sale de `manifest.meta.language`). Sin `videoUrl` hasta Feature 9. El `locale` de la ruta es el idioma de la **interfaz** y no filtra ni cambia el contenido: todos los debates publicados aparecen en todos los `locale`, cada uno en su propio idioma (D16).

- **AC 3.66** — `/[locale]` lista solo episodios con `publishedAt` no nulo y estado en `SHOWCASE_STATUSES`, de más nuevo a más viejo, con título, distintivo de idioma del debate, fecha y duración (`durationSec`). Ningún otro episodio aparece nunca, tampoco por URL directa.
- **AC 3.67** — `/[locale]/e/[id]` muestra: título, distintivo de idioma del debate (desde `manifest.meta.language`), player contra el manifest (D2), la transcripción completa por segmento con el nombre del agente, y el veredicto con el nombre del ganador (o "Sin ganador").
- **AC 3.68** — `/[locale]/e/[id]` de un episodio inexistente, no publicado o fuera de `SHOWCASE_STATUSES` responde "no encontrado" (la API devuelve `404 NOT_FOUND` en los tres casos), sin revelar que el episodio existe.
- **AC 3.69** — Ninguna respuesta que consume el showcase incluye `usage`, `limits`, `checkpoints`, `pipelineActive`, `publishedAt`, notificaciones ni el origen (`AI_GENERATED`/`HUMAN_EDITED`) de los argumentos. `voiceId` y `audioAssetId` dentro del manifest se aceptan como expuestos; `language` es público. Verificable inspeccionando las respuestas de red sin sesión.
- **AC 3.70** — Las páginas del showcase entregan el título y la transcripción en el HTML inicial (indexable sin ejecutar JS) y tienen título y descripción propios por episodio, para compartir el link.
- **AC 3.71** — Showcase vacío: mensaje explícito, no una grilla en blanco.
- **AC 3.72** — Ni el HTML del showcase ni las respuestas que llevan `audioUrl` se cachean por más tiempo que el TTL de las URLs de audio. Las URLs vencidas se renuevan igual que en el preview (AC 3.59).
- **AC 3.80** — Rutas del showcase preparadas para i18n (D16): `/` responde con una redirección temporal (307) a `/es`; `/es` y `/es/e/[id]` funcionan; cualquier otro valor del segmento de idioma (por ejemplo, `/en`, `/pt`, `/xx`, `/en/e/[id]`) responde 404 hasta que ese idioma de interfaz exista. La interfaz del showcase (etiquetas, botones, textos fijos, mensajes de vacío y error) está en español. Los enlaces internos del showcase y el enlace desde el preview (AC 3.64) siempre incluyen el segmento de idioma.

### 10. Transversales

- **AC 3.73** — Toda pantalla que consulta datos tiene estados explícitos de carga, vacío y error (nunca pantallas en blanco).
- **AC 3.74** — Las fechas se muestran en la zona horaria del navegador; las relativas ("hace 5 min") tienen la absoluta disponible (por ejemplo, en un tooltip).
- **AC 3.75** — Las acciones destructivas o de alcance público (`reject`, `publish`, `unpublish`) y las que consumen presupuesto (`regenerate`, `regenerate-audio`) siempre piden confirmación; las demás no.
- **AC 3.76** — El panel es usable en una pantalla de escritorio de 1280 px de ancho; el showcase, además, en móvil (360 px).
- **AC 3.77** — Los controles se pueden operar con teclado y los diálogos de confirmación atrapan el foco (lo da shadcn/ui; se verifica, no se asume).
- **AC 3.79** — Idioma declarado en el HTML. Tiene tres partes, que se cumplen en fases distintas:
  - **(a) Panel, F1**: `/login` y todas las rutas `/studio/*` declaran `lang="es"` en `<html>` (hoy `apps/dashboard/src/app/layout.tsx:23` tiene `lang="en"`).
  - **(b) Contenido del debate en el panel, F2** (requiere las pantallas de F2 y API-17): los argumentos, el veredicto y el feed marcan su bloque con el idioma del episodio (`es`, `en` o `pt`), para que lectores de pantalla y buscadores los pronuncien e indexen bien aunque la interfaz esté en español.
  - **(c) Showcase, F4**: `<html lang>` toma el `locale` de la ruta (en F4, siempre `es`), y la transcripción y el veredicto marcan su bloque con el idioma del debate (`manifest.meta.language`).

## Edge cases

Casos que el happy path no muestra y que la UI tiene que contemplar:

- **Eventos SSE perdidos**: el stream no tiene replay. Abrir la pantalla a mitad del debate, o una desconexión, pierde eventos; por eso el detalle es la fuente de verdad (D7, AC 3.37, AC 3.38).
- **El stream se cierra solo**: el backend completa el stream cuando termina una ejecución del pipeline, y (con API-12) enseguida si el pipeline no está activo. Un cliente SSE que reconecta automáticamente entraría en un loop contra un episodio frenado; la UI corta al llegar a un estado sin SSE (AC 3.36) y solo reconecta con `pipelineActive` en `true` (AC 3.38).
- **Proxy que corta conexiones inactivas**: el rewrite de Next corta el socket tras 30 s sin tráfico. Research y debate pueden pasar más que eso sin emitir eventos. Lo cubren el `heartbeat` (API-13) y el timeout del proxy (Restricciones técnicas); AC 3.33 lo verifica.
- **Episodio trabado**: un error de sistema no clasificable deja el episodio en su estado activo (no en `FAILED`, contra lo que dice `features.md` Feature 4) con el pipeline detenido; se retoma recién al reiniciar el backend. Sin `pipelineActive`, la UI mostraría "en vivo" para siempre (AC 3.39).
- **Fases sin eventos SSE**: `APPROVED` y `GENERATING_AUDIO` no emiten eventos; sin polling, el curador que aprobó nunca vería llegar `READY_FOR_RENDER` (AC 3.35).
- **`argument.approved` sin identificador**: el payload real solo trae `agentId` y `text` (no `sequenceIndex` ni `argumentId`); no se puede ubicar el argumento en el timeline a partir del evento. D7 lo cubre; no es un gap de API, solo hay que corregir la documentación.
- **Dos pestañas sobre el mismo episodio**: una aprueba mientras la otra edita; la segunda recibe `409 INVALID_STATE_TRANSITION` (AC 3.48).
- **Editar después de que se emitió el veredicto**: `edit`/`regenerate` en `PENDING_REVIEW` cambian argumentos que el juez ya evaluó, y el veredicto no se recalcula (pregunta 5).
- **Presupuesto agotado en `PENDING_REVIEW` o `READY_FOR_RENDER`**: en esos estados no hay forma de subir los límites; por eso "Regenerar" y "Regenerar audio" se deshabilitan antes de que la llamada falle (AC 3.46, AC 3.61).
- **Mismo motivo tras reanudar**: el backend decide "la causa se repitió" comparando solo con el checkpoint más reciente. Si tras reanudar ocurre el mismo motivo en cualquier fase, antes de que ocurra uno distinto, el episodio pasa a `FAILED`. Por ejemplo, un `PROVIDER_QUOTA_EXCEEDED` en research y otro días después en audio (AC 3.52).
- **`REQUIRES_HUMAN_REVIEW` desde `GENERATING_AUDIO`**: además de las fases de `features.md`, el backend real también puede frenar en audio (`PROVIDER_QUOTA_EXCEEDED` por TTS, y `VOICE_NOT_CONFIGURED`). Al reanudar, esa fase no tiene SSE: corresponde polling (AC 3.53).
- **`USAGE_LIMIT_EXCEEDED` por segmentos TTS**: hasta API-16 no se puede subir `maxTtsSegments`; solo queda "Rechazar" (AC 3.51).
- **`VALIDATION_INCONSISTENCY`**: reanudar falla de forma determinista (D13). Con las rondas por defecto es prácticamente inalcanzable, pero el panel existe igual.
- **Idioma sin voces al crear**: `createEpisode` responde `409 VOICE_NOT_CONFIGURED` y no se crea nada (AC 3.78).
- **Voces que desaparecen después de crear**: si el seed cambia entre la creación y la síntesis, el episodio frena con `VOICE_NOT_CONFIGURED`. Reanudar sin corregir el seed repite el motivo y manda el episodio a `FAILED` (AC 3.52).
- **Modelo de voz que no se puede descargar** (sin red): hoy sale como `PROVIDER_QUOTA_EXCEEDED`, no como `VOICE_NOT_CONFIGURED` (ADR 0002, consecuencias). El panel de `PROVIDER_QUOTA_EXCEEDED` no puede distinguir ese caso.
- **Querer otro idioma para un episodio existente**: no se puede (D15); hay que crear otro episodio con el mismo tópico.
- **Idioma de interfaz distinto del idioma del debate**: en `/es/e/[id]` puede verse un debate en inglés o portugués; la interfaz sigue en español y el contenido en su idioma, marcado como tal (D16, AC 3.79 c).
- **Link a un idioma de interfaz que todavía no existe** (`/en/e/[id]`): 404 en F4 (AC 3.80). Nadie puede haberlo recibido compartido, porque la UI nunca genera esos links.
- **Navegar entre el panel y el showcase** (por ejemplo, el enlace "ver el showcase" de AC 3.15 o el enlace público de AC 3.64): al tener layouts raíz distintos, Next hace una recarga completa de página. Se acepta.
- **`usage` null**: episodios recién creados sin consumo registrado (AC 3.30).
- **Límite nuevo menor o igual al consumo**: reanudar volvería a disparar la misma causa y mandaría a `FAILED`; el formulario lo impide (AC 3.51).
- **URL de audio vencida a mitad de reproducción**, o preview/showcase abierto en segundo plano más que el TTL (AC 3.59, AC 3.72).
- **Segmento sin `audioUrl`** (AC 3.63).
- **`regenerate-audio` sobre un episodio publicado**: está permitido y cambia lo que oye el público; la UI lo avisa (D10, AC 3.60).
- **Despublicar con visitantes mirando**: quien ya tiene la página abierta puede seguir reproduciendo hasta que venzan las URLs de audio; no hay forma de cortar una reproducción en curso. Se acepta.
- **`argumentId` de otro episodio**: hoy `edit`/`regenerate` lo aceptan (API-14); la UI nunca lo manda, pero el backend debería rechazarlo.
- **Logout con token sin estado**: `POST /auth/logout` borra la cookie en ese navegador, pero una copia del token sigue siendo válida hasta que vence (7 días). La única revocación es rotar `SESSION_SECRET`, que cierra todas las sesiones (ADR 0001).
- **Sesión vencida con un formulario cargado** (fuentes manuales, edición): como mínimo se avisa que la acción no se ejecutó (AC 3.7).
- **Parámetro `next` malicioso en `/login`** (AC 3.1).
- **Tópico largo** (hasta 300 caracteres): la lista y las cabeceras truncan, con acceso al texto completo.
- **Argumento muy largo o con saltos de línea**: se respetan los saltos; el editor inline crece con el contenido.
- **Estados no alcanzables hoy** (`RENDERING`, `COMPLETED`): mapeados igual, para que la UI no se rompa cuando exista Feature 9.

## MVP vs. nice-to-have

**MVP** (la spec se cumple con esto):

- Auth de un solo usuario y protección de `/studio` y de la API (sección 1).
- Layout del panel + inbox con contador, marcar leída/todas, deep-link (sección 2).
- Lista agrupada y filtrable, con idioma y estado de publicación (sección 3); crear episodio con idioma (sección 4).
- Detalle con timeline, veredicto, uso vs. límites, checkpoints, feed SSE, polling y detección de episodio trabado (sección 5).
- Curaduría completa en `PENDING_REVIEW` (sección 6) y resolución de los 6 motivos (sección 7).
- Preview con audio, regenerar audio por segmento, publicar/despublicar (sección 8).
- Showcase público con interfaz en español bajo `/es`: lista + detalle con player contra el manifest, transcripción e idioma del debate, y rutas preparadas para i18n (sección 9, D16).

**Nice-to-have** (fuera del MVP; no se implementan sin pedirlo):

- **i18n completo de la interfaz del showcase** (D16, fuera de F4): interfaz en `/en` y `/pt` además de `/es`, selector de idioma de interfaz visible en el showcase, textos traducidos, `/` redirigiendo según el idioma del navegador del visitante, y enlaces alternativos entre idiomas para buscadores. No cambia ninguna URL existente.
- Evidencia (fuentes de la Evidence Base) visible en el detalle (API-2). Útil para decidir en `INSUFFICIENT_EVIDENCE`, pero la resolución funciona sin verla.
- Resultado del fact-check por argumento (API-3, Feature 10 UI P1).
- Diff de lo que editó el humano vs. el texto original de la IA (API-4).
- Selector de idioma del debate que deshabilite de antemano los idiomas sin voces configuradas (requiere un endpoint que las exponga; hoy el curador se entera por el `409` de AC 3.78).
- Filtro de la lista (panel o showcase) por idioma del debate.
- Notificaciones del navegador (Notification API) además del inbox.
- Búsqueda por texto en la lista de episodios; paginación (hoy `listEpisodes` no pagina).
- Descarga del `.mp4` o del manifest desde el panel.
- Modo oscuro.
- Métricas agregadas (costo total, episodios por estado en el tiempo).

## Cambios requeridos en la API

Dependencias de backend (D3). "Bloquea" indica qué AC no se pueden cumplir sin el cambio. "Fase" es la fase del plan que lo necesita.

| ID | Cambio | Pantalla | Bloquea | Prioridad | Fase |
|---|---|---|---|---|---|
| API-1 | `getEpisodeDetail` trae el **tópico**, `createdAt`, `language` y los **participantes** (id, nombre/persona, `isJudge`). Hoy no trae ninguno; `getManifest` ya carga los participantes. Además, `listEpisodes` expone `language`. | Detalle, lista, curaduría, resolución | AC 3.17 (idioma), 3.26-3.29, 3.32, 3.51 (agente afectado en `VALIDATION_INCONSISTENCY`; participantes en `VOICE_NOT_CONFIGURED`), 3.79 b | Bloqueante | F2 |
| API-2 | Consultar las **fuentes de la Evidence Base** de un episodio. | Detalle, panel `INSUFFICIENT_EVIDENCE` | Ninguno del MVP | No bloqueante (nice-to-have) | — |
| API-3 | Exponer los **fact-checks por argumento** (Feature 10, UI P1). | Detalle | Ninguno del MVP | No bloqueante | — |
| API-4 | Exponer el **`ArgumentHistory`** (texto original antes de la edición humana). | Detalle | Ninguno del MVP | No bloqueante | — |
| API-5 | Schema de respuesta de `listNotifications` en `openapi.json` (y de `markNotificationRead`/`markAllNotificationsRead`). Sin él, el inbox no se puede tipar sin violar D5. | Inbox | AC 3.10-3.14 | Bloqueante | F2 |
| API-6 | El filtro `status` de `listEpisodes` está tipado como `string` libre (CSV parseado en el servicio), así que el cliente no puede tipar los valores válidos. Un `status` inválido hoy devuelve `BADREQUEST` en vez de `VALIDATION_ERROR` (`episodes.service.ts:133`). | Lista | Ninguno (funciona) | Mejora | — |
| API-7 | **Acciones de publicación y endpoints del showcase.** Acciones `publish`/`unpublish` desde `READY_FOR_RENDER` o posterior (`409 INVALID_STATE_TRANSITION` fuera de eso), que escriben el `publishedAt` de API-7a. `showcase.controller.ts` dentro de `EpisodesModule`, `@Controller("showcase")` + `@Public()`: `GET /showcase/episodes` (`listShowcaseEpisodes` → `{ id, title, createdAt, durationSec, language }[]`) y `GET /showcase/episodes/:id` (`getShowcaseEpisode` → `{ id, title, createdAt, manifest }`, con el idioma en `manifest.meta.language`). Filtran por `publishedAt` no nulo y estado en `SHOWCASE_STATUSES`; inexistente o no público → `404 NOT_FOUND` (no usar `MANIFEST_NOT_READY` para decidir si es público). Prefijo `/showcase` y no `/public`, porque `main.ts:25` ya sirve estáticos en `/public`. Sin `videoUrl` hasta Feature 9. Los endpoints no reciben el `locale` de la interfaz (D16). | Showcase, preview | AC 3.64-3.72 | Bloqueante para publicar | F4 |
| API-7a | **`publishedAt` en detalle y listado.** Columna `Episode.publishedAt` (nullable, `null` hasta que exista `publish`), expuesta en `getEpisodeDetail` y en `listEpisodes`. Separado de API-7 para que el distintivo "Publicado" se construya en F2 (decisión del usuario, D10). | Lista, detalle | AC 3.17 y 3.26 (distintivo "Publicado") | Bloqueante | F2 |
| API-8 | **Auth** según ADR 0001: `modules/auth` (`POST /auth/login`, `POST /auth/logout`, `GET /auth/session`), `SessionGuard` global que niega por defecto, `@Public()` en `shared/http`, variables `CURATOR_USERNAME`/`CURATOR_PASSWORD_HASH`/`SESSION_SECRET` sin defaults, y eliminar `enableCors()`. Además: rate-limit simple en `/auth/login`; `trust proxy` (la API queda detrás del rewrite de Next); `401 UNAUTHORIZED` documentado en OpenAPI; en producción, `EnvSchema` falla al arrancar si `AUDIO_SIGNING_SECRET` conserva el default. | Todas las de `/studio`, login | AC 3.1-3.9 y cualquier exposición fuera de local | Bloqueante para publicar | F1 |
| API-9 | ~~Agente afectado en `VALIDATION_INCONSISTENCY`~~. **Cerrado vía API-1**: con los participantes y los argumentos de la ronda se identifica al agente sin argumento aprobado. El `snapshot` que menciona `frontend-notes.md` es `EpisodeUsage` y no sirve para esto. | — | — | Cerrado | — |
| API-10 | `runEpisodeAction` no documenta bodies ni respuestas por acción (`action` es `string` libre, respuesta sin schema); el envelope de error y sus códigos (`INVALID_STATE_TRANSITION`, `MANIFEST_NOT_READY`, `INVALID_SEQUENCE_INDEX`, `VALIDATION_ERROR`, `NOT_FOUND`, `FORBIDDEN`, `UNAUTHORIZED`, `USAGE_LIMIT_EXCEEDED`, `PROVIDER_QUOTA_EXCEEDED`, `VOICE_NOT_CONFIGURED`) no están en `openapi.json`. `getEpisodeAudioUrl` no tiene schema de respuesta (el dashboard no lo usa). Corregir en `features.md`/`api-contract.md` la documentación de `argument.approved` (no lleva `sequenceIndex`). | Crear, curaduría, resolución, preview | Ninguno (alcanza con tipos parciales), pero obliga a tipar bodies y errores a mano, contra D5 | No bloqueante, recomendado antes de F2 | F2 |
| API-10b | Mapeo de errores en acciones que llaman a proveedores: `BudgetExceededError` → `409 USAGE_LIMIT_EXCEEDED`; errores del proveedor (cuota LLM, TTS no disponible) → `503 PROVIDER_QUOTA_EXCEEDED`. Afecta `regenerate` (`episode-actions.service.ts:99,109`) y `regenerate-audio` (`:131`). Hoy salen como `500 INTERNAL_ERROR`. | Curaduría, preview | AC 3.50, 3.62 (mensajes específicos) | No bloqueante | F2 |
| API-11 | No hay eventos SSE para `APPROVED`/`GENERATING_AUDIO` (ni uno genérico de cambio de estado). La spec lo cubre con polling. | Detalle | Ninguno | Mejora | — |
| API-12 | Campo `pipelineActive: boolean` en `getEpisodeDetail` (si hay una ejecución del pipeline en curso para ese episodio). `streamEpisodeEvents` completa enseguida si el pipeline no está activo. | Detalle, lista | AC 3.32, 3.35, 3.38, 3.39 | Bloqueante | F2 |
| API-13 | Evento SSE `heartbeat` cada 15 s mientras el pipeline está activo, documentado como séptimo DTO SSE en `openapi.json`, y cabecera `Cache-Control: no-transform` en el stream. | Detalle | AC 3.33 | Bloqueante (sin él la conexión se corta a los 30 s detrás del rewrite) | F2 |
| API-14 | `edit`/`regenerate` no validan que el `argumentId` pertenezca al episodio (`episode-actions.service.ts:56,73`). Debe responder `404 NOT_FOUND`. | Curaduría | Ninguno (la UI nunca manda uno ajeno) | Importante (integridad) | F2 |
| API-15 | `resume` aplica los límites nuevos antes de validar el estado (`episode-actions.service.ts:151` vs. `:153`): un `resume` inválido puede dejar límites modificados. | Resolución | Ninguno | Menor | — |
| API-16 | Aceptar `maxTtsSegments` en `UsageLimitResumeSchema`. Mientras no exista, la UI ofrece solo "Rechazar" cuando la métrica agotada es `ttsRequests`. | Resolución | Parte de AC 3.51 | No bloqueante | F2 |
| API-17 | **Idioma del debate (lo entrega la spec 004 y el ADR 0002).** `CreateEpisodeDto` acepta `language` (`DebateLanguage`, default `ES`); `createEpisode` responde `409 VOICE_NOT_CONFIGURED` si el idioma no tiene voces para el proveedor activo; `CheckpointReason` suma `VOICE_NOT_CONFIGURED` (se reanuda con `{}`); `RemotionManifest` suma `meta.language`. Todo reflejado en `openapi.json`. | Crear, resolución, preview, showcase | AC 3.22, 3.51 (fila `VOICE_NOT_CONFIGURED`), 3.67, 3.78, 3.79 b | Bloqueante | F2 |
| API-18 | Qué agentes no tienen voz en un `VOICE_NOT_CONFIGURED` (el checkpoint solo trae el motivo). Sin esto, el panel lista todos los participantes como agentes a revisar. | Resolución | Parte de AC 3.51 (fila `VOICE_NOT_CONFIGURED`) | No bloqueante | — |

## Dependencias con otras specs, features y docs

- **ADR 0001** (`docs/adr/0001-auth-sesion-nest-mismo-origen.md`): topología de auth, sesión, origen único y rewrites (D1, API-8).
- **Spec 004** (`docs/product/004-debate-language.md`): idioma del debate por episodio (D15, API-17). Esta spec solo consume el idioma (selector al crear, distintivos, motivo `VOICE_NOT_CONFIGURED`); el comportamiento del pipeline según el idioma es de la 004. El idioma de la **interfaz** del showcase (D16) es independiente de la 004.
- **ADR 0002** (`docs/adr/0002-voces-por-agente-e-idioma.md`): voces TTS por agente, idioma y proveedor; origen de `409 VOICE_NOT_CONFIGURED` y del `CheckpointReason` `VOICE_NOT_CONFIGURED` (AC 3.51, AC 3.78).
- **Spec 001** (`001-openapi-contract-zod.md`): fuente de los tipos (D5). Sus pendientes (`@ZodResponse` en acciones, `ResumeActionBodySchema` sin DTO) son API-10.
- **Spec 002** (`002-workspace-restructure.md`): scaffold de `apps/dashboard`, paquetes `@ai-trend-debates/contracts` y `@ai-trend-debates/video`, `check-boundaries`. Su bitácora deja para esta spec "reproducir audio real" en `packages/video` (el theme actual es un placeholder sin audio): lo cubre la F3.
- **`coding-rules.md` §1**: hay que ajustarlo para permitir varios controllers por módulo cuando la política de acceso es distinta (`showcase.controller.ts` público dentro de `EpisodesModule`, API-7).
- **Features 4, 5, 6, 7, 8** (`features.md`, congelado): estados y checkpoints, acciones de curaduría, audio firmado y regeneración por segmento, manifest, eventos SSE.
- **Feature 9** (sin arrancar): el showcase no la espera (D2). El `.mp4` y los estados `RENDERING`/`COMPLETED` solo existen cuando se implemente.
- **Feature 10** (UI P1): API-3 y API-4.
- **`decision-log.md` raíz, entradas 8 y 9**: `PROVIDER_QUOTA_EXCEEDED` y notificaciones por polling.

## Restricciones técnicas

Restricciones y riesgos que la implementación debe respetar o resolver.

- **Next.js 16 no es el Next.js conocido** (`apps/dashboard/AGENTS.md`): antes de escribir código, leer la guía de la versión instalada en `node_modules/next/dist/docs/` y respetar sus avisos de deprecación. El middleware de esta versión es `src/proxy.ts`.
- **Sin backend en Next**: `apps/dashboard` no tiene `app/api`. `src/proxy.ts` solo hace el chequeo optimista de la cookie en `/studio/*`; la autorización real es el `401` de Nest (ADR 0001).
- **Layouts raíz separados para panel y showcase (AC 3.79, D16).** Hoy `apps/dashboard/src/app/layout.tsx` es el único layout raíz y fija `lang="en"` (línea 23) para toda la app. Se reemplaza por dos layouts raíz, sin `app/layout.tsx` compartido. Verificado en la documentación de Next 16.3.6 instalada (`next/dist/docs/01-app/03-api-reference/03-file-conventions/layout.md`, sección "Root Layout"; `route-groups.md`; `02-guides/internationalization.md`):
  - **Panel**: un route group, por ejemplo `app/(panel)/layout.tsx`, con `<html lang="es">`, que contiene `login/` y `studio/`. Los route groups no agregan segmento a la URL, así que las rutas siguen siendo `/login` y `/studio/*`.
  - **Showcase**: `app/[locale]/layout.tsx` como layout raíz bajo un segmento dinámico (la guía de i18n de Next 16 lo documenta así: "The root layout can also be nested in the new folder (e.g. `app/[lang]/layout.js`)"), con `<html lang={locale}>`. Contiene `page.tsx` (`/[locale]`) y `e/[id]/page.tsx`. `locale` es un *root param* que cualquier Server Component puede leer con `next/root-params`. Los valores válidos se limitan a `es` (por ejemplo, con `generateStaticParams` y la validación que muestra la guía, que responde 404 si el valor no es válido), lo que cumple AC 3.80.
  - **Convivencia de rutas**: los segmentos estáticos `login` y `studio` del route group tienen prioridad sobre el dinámico `[locale]`. Los rewrites de `next.config` definidos como array (`/api/:path*`, `/audio-files/:path*`) se aplican antes que las rutas dinámicas (`rewrites.md`), así que `[locale]` no los captura.
  - **`/`**: sin layout raíz en `app/`, la raíz no tiene página propia; se resuelve con la redirección temporal a `/es` de AC 3.80. La documentación advierte que, con varios layouts raíz sin `app/layout.js`, la ruta `/` tiene que definirse dentro de algún grupo o resolverse de otra forma.
  - **404 global**: con varios layouts raíz no hay un único layout para una 404 de URLs que no matchean ninguna ruta. Next 16 ofrece `app/global-not-found.js`, marcado como **experimental** en la documentación instalada. Verificar el flag antes de usarlo, o resolver la 404 con `not-found` dentro de cada layout raíz.
  - **Costo aceptado**: navegar entre layouts raíz distintos (panel ↔ showcase) hace una recarga completa de página (`route-groups.md`, "Caveats").
- **Rewrites y SSE**: `next.config` reescribe `/api/:path*` y `/audio-files/:path*` hacia `API_INTERNAL_URL`. El proxy de rewrites corta el socket tras 30 s de inactividad (`proxy-request.js:37`, `proxyTimeout || 30000`), así que hace falta `experimental.proxyTimeout` alto además del `heartbeat` (API-13). **Spike pendiente**: verificar que la compresión no bufferee `text/event-stream` a través del rewrite (de ahí el `Cache-Control: no-transform`).
- **Cliente SSE**: escuchar cada tipo de evento con `addEventListener` (los eventos tienen nombre, así que `onmessage` no recibe nada). En `onerror`: `close()`, refetch del detalle y reconexión solo si el estado lo amerita y `pipelineActive` es `true` (AC 3.38). Un `401` en el SSE no se puede leer desde `EventSource`; se detecta por el refetch.
- **Cliente HTTP** (D11): `openapi-fetch` con `baseUrl` `/api` en el navegador y `API_INTERNAL_URL` en el render de servidor del showcase. El panel obtiene datos del lado del cliente; el servidor de Next nunca reenvía cookies.
- **Tipos generados**: `avatarUrl` usa `type: ["string","null"]` (sintaxis de OpenAPI 3.1) dentro de un documento `openapi: 3.0.0`; hay que verificar qué genera `openapi-typescript` con eso. `audioUrl` es opcional en el contrato y el player tiene que tolerar que falte (AC 3.63). `DebateLanguage` sale del enum generado de `openapi.json` (o de `DebateLanguageSchema` en `@ai-trend-debates/contracts` para el manifest), nunca de una lista escrita a mano (D5). Los `locale` de interfaz del showcase (`es`, y más adelante `en`/`pt`) son una lista propia del dashboard y no se derivan de `DebateLanguage`: son conceptos distintos (D16).
- **`packages/video` como librería** (F3):
  1. Nuevo `src/studio.ts` con `registerRoot`; el script pasa a `"studio": "remotion studio src/studio.ts"`.
  2. `src/index.ts` pasa a ser librería pura (sin efectos al importarse): exporta `DebateComposition`, `DebateCompositionPropsSchema`/`DebateCompositionProps`, `buildTimelineFrames`, `totalDurationInFrames` y `DEBATE_VIDEO = { fps: 30, width: 1920, height: 1080 }`. Esto elimina el FPS duplicado (`Root.tsx:8` y `DebateComposition.tsx:20`).
  3. `react`, `react-dom` y `remotion` pasan a `peerDependencies` (y `devDependencies`); `@remotion/cli` a `devDependencies`; `@remotion/player` se mueve a `apps/dashboard`.
  4. Catálogo de pnpm con versiones exactas: `react`/`react-dom` `19.3.0` y `remotion`/`@remotion/*` `4.0.528` (hoy el dashboard fija React `19.2.8` y `packages/video` pide `^19.3.0`). Criterio: `pnpm why react` muestra una sola versión.
- **Turborepo y tipos**: `apps/dashboard/turbo.json` con `extends: ["//"]` y una tarea `generate:api` (`openapi-typescript` desde `$TURBO_ROOT$/openapi.json`, salida `src/lib/api/schema.d.ts`). `build`, `dev` y `lint` dependen de `generate:api`, con `env: ["API_INTERNAL_URL"]`. En la raíz, `dev.dependsOn: ["^build"]`.
- **Límites del workspace**: `apps/dashboard` no importa nada de `apps/api` (solo `openapi.json` como artefacto, más los paquetes de `packages/`). `check-boundaries` se extiende a `apps/dashboard` (prohibido `@ai-trend-debates/api` y los imports relativos que salen del paquete), detecta también `import()` dinámico e `import "x"`, y corre en CI o como `prebuild` (F1).
- **Puerto de la API**: `main.ts:54` hace `listen(3000)` sin usar `PORT`; `API_INTERNAL_URL` tiene que apuntar a ese puerto hasta que se corrija.
- **La credencial nunca llega al bundle del cliente** ni a los logs.
- **`openapi.json` es de solo lectura para el dashboard**: si falta algo, se cambia el backend y se regenera (`pnpm openapi:generate`).

## Plan de implementación

Fases alineadas con `apps/dashboard/docs/roadmap.md` (que habrá que actualizar: ya no la bloquean 001/002). Cada fase cierra con un criterio verificable.

1. **F1 — Base: auth, origen único, cliente tipado, layouts.**
   - Backend: API-8 (auth según ADR 0001, sin `enableCors()`).
   - Dashboard: stack de D4; rewrites y `proxyTimeout`; `src/proxy.ts`; `turbo.json` con `generate:api`; cliente tipado (D11); los dos layouts raíz (panel `(panel)` con `lang="es"` y showcase `[locale]` con `es` como único valor; ver Restricciones técnicas) y la redirección de `/` a `/es`; `/login`.
   - Workspace: `check-boundaries` extendido a `apps/dashboard`.
   - Recomendado en paralelo: API-1, API-5, API-7a, API-10, API-12, API-13 y la parte de backend de la spec 004 (API-17).
   - Criterio: `pnpm build` en verde; AC 3.1-3.9, AC 3.15 y AC 3.79 (a) cumplidos; `/` redirige a `/es` y `/en` responde 404; un cambio en `openapi.json` que rompa un tipo usado hace fallar el build del dashboard; un import prohibido hace fallar `check-boundaries`.
2. **F2 — Panel de curación.**
   - Lista (con idioma y distintivo "Publicado"), crear (con idioma), detalle con vista en vivo, curaduría, resolución de los 6 motivos, inbox.
   - Requiere API-1, API-5, API-7a, API-12, API-13 y API-17. Recomendados: API-10, API-10b, API-14, API-16.
   - Spike de compresión de SSE a través del rewrite.
   - Criterio: AC 3.10-3.55, AC 3.78 y AC 3.79 (b) cumplidos; se crea un episodio desde la UI en cada idioma con voces configuradas y se sigue en vivo hasta `PENDING_REVIEW` sin recargar y sin cortes de conexión; crear en un idioma sin voces muestra el mensaje de AC 3.78; se fuerza cada motivo de `REQUIRES_HUMAN_REVIEW` en local (límites bajos, sin claves, quitando una voz del seed, etc.) y se resuelve desde la UI; el distintivo "Publicado" se verifica con `publishedAt` puesto a mano.
3. **F3 — Preview.**
   - `packages/video` como librería (Restricciones técnicas, puntos 1-4) con audio real en la composición (pendiente heredado de la spec 002); player embebido; renovación de URLs; regenerar audio.
   - Criterio: AC 3.56-3.63 cumplidos; `pnpm why react` muestra una sola versión; `pnpm video:studio` sigue funcionando; approve lleva, sin recargar, a un preview con sonido.
4. **F4 — Publicación y showcase público (interfaz en español).**
   - Requiere API-7 y API-8 en producción, con el TTL de audio de D12.
   - Ajuste de `coding-rules.md` §1.
   - Fuera de F4: la interfaz en `/en` y `/pt` (nice-to-have, D16).
   - Criterio: AC 3.64-3.72, AC 3.79 (c) y AC 3.80 cumplidos; sin sesión, el showcase funciona y ninguna respuesta de red contiene datos internos; con curl sin sesión, las acciones devuelven `401`; un episodio sin publicar o despublicado responde `404` en `/showcase/episodes/:id`.

## Criterio de aceptación

La spec se considera implementada cuando todo lo siguiente da verde:

- `pnpm build` compila todo el workspace, incluido `apps/dashboard`, y los tests existentes pasan.
- `pnpm openapi:generate && git diff --exit-code openapi.json` sigue dando 0 después de los cambios de backend de esta spec.
- Ningún tipo de la API está escrito a mano en `apps/dashboard` (revisión de código contra D5), y `check-boundaries` pasa.
- Recorrido completo: login → crear episodio eligiendo un idioma distinto de español → seguirlo en vivo hasta `PENDING_REVIEW` → editar un argumento y regenerar otro → aprobar → ver llegar `READY_FOR_RENDER` sin recargar → preview con audio → regenerar el audio de un segmento → publicar → desde una ventana sin sesión, entrar a `/`, llegar a `/es` y ver el episodio con su idioma en la lista y en `/es/e/[id]` → despublicar → el episodio desaparece del showcase.
- Cada uno de los 6 motivos de `REQUIRES_HUMAN_REVIEW` se resolvió al menos una vez desde la UI (reanudar o rechazar, según el panel).
- Sin sesión: `/studio/*` redirige a `/login` y las acciones de la API devuelven `401` con curl.
- Todos los AC 3.1-3.80 verificados.

## Preguntas abiertas

Siguen sin resolver y quedan para el usuario:

4. **Origen `HUMAN_EDITED` en el showcase** (antes de F4). Con el diseño de API-7 no se expone, por construcción (AC 3.69). ¿Se quiere mostrarle al visitante qué partes editó el curador (transparencia), lo que requeriría ampliar la respuesta pública?
5. **Veredicto tras editar/regenerar** (antes de F2). El juez evaluó el debate antes de la curaduría; si el curador cambia argumentos, el veredicto puede quedar incoherente. ¿Alcanza con un aviso en la UI, o se espera algo del backend (fuera del alcance de esta spec)?
8. **Intervalos de polling** (F2, barato de cambiar). Propuestos: 30 s para el inbox, 10 s para el detalle en fases sin SSE. ¿Hay alguna restricción (por ejemplo, el costo del hosting de la API) que los condicione?
10. **`/docs` en producción** (antes de F4). Swagger queda fuera del `SessionGuard`. ¿Se desactiva en producción, se protege con la sesión, o queda público?

Resueltas (se conserva la numeración original):

1. **Resolución de `VALIDATION_INCONSISTENCY`**: `resume {}` vuelve a lanzar la excepción en `pickCrossExaminationTarget` y el episodio pasa a `FAILED` de forma determinista (verificado por `architect`). Resultado: D13 (decidido por defecto, revisable).
2. **`USAGE_LIMIT_EXCEEDED` por TTS**: es un gap de backend. Resultado: API-16; hasta entonces, solo "Rechazar".
3. **¿Publicación automática?**: no; hay un paso explícito de publicar (D10, fija).
6. **Nombres de agentes sin API-1**: no hay modo degradado; se espera API-1 (D14, decidido por defecto, revisable).
7. **Idioma de la interfaz del showcase** (resuelta por el usuario el 2026-09-25): el objetivo es un i18n completo (`/es`, `/en`, `/pt` y selector), independiente del idioma de cada debate, pero es nice-to-have y no entra en F4. F4 sale con la interfaz en español y rutas preparadas desde el día uno. Resultado: D16, AC 3.80, AC 3.79 (c).
9. **Duración en el showcase**: `meta.durationEstimatedSec` ya es la suma real de las duraciones (`render.service.ts:74`); el showcase usa `durationSec` de API-7.

## Contradicciones detectadas entre docs

Surgidas al cruzar los insumos con `openapi.json` y el código real. Para esta spec, la fuente de verdad fue siempre `openapi.json` y el código; corregir los docs queda fuera de esta spec.

- **`frontend-notes.md` vs. `api-contract.md` §5**: da `regenerate` como resolución de `VALIDATION_INCONSISTENCY`, pero `regenerate` no es válido en `REQUIRES_HUMAN_REVIEW` y exige un `argumentId` que en ese caso no existe. La resolución real es la de D13.
- **`frontend-notes.md`**: su ejemplo ("un curador usó la acción `reject` sobre un draft") es imposible, porque `reject` actúa sobre el episodio entero, no sobre un argumento. Dice además que el agente afectado "viene en `debateRoundId` + `snapshot`", pero el `snapshot` es `EpisodeUsage` y no está expuesto. Y enumera 4 motivos; con `PROVIDER_QUOTA_EXCEEDED` y `VOICE_NOT_CONFIGURED` (ADR 0002) son 6.
- **`features.md` Feature 4**:
  - Dice que los errores de sistema no clasificables llevan a `FAILED`; en el código, el episodio queda trabado en su estado activo hasta reiniciar el backend (de ahí API-12).
  - Dice que `REQUIRES_HUMAN_REVIEW` se dispara desde `RESEARCHING`, `DEBATING` o `JUDGING`; el backend real también lo hace desde `GENERATING_AUDIO`.
  - `PROVIDER_QUOTA_EXCEEDED` cubre tanto la cuota del LLM como la indisponibilidad del TTS.
- **`features.md` Feature 8 / `api-contract.md` §4**: `argument.approved` incluye `sequenceIndex`; el payload real no. `fact_check.completed` usa `TRUE/FALSE` en `features.md` y `PASSED/FAILED` en el real (ya documentado en la spec 001).
- **`api-contract.md` §2 `POST /episodes`**: documenta la respuesta con `topic: { id, title }`; la real (`EpisodeDto_Output`) trae `title` plano, `debateId`, límites y configuración de rondas.
- **`api-contract.md` §1**: no lista `VALIDATION_ERROR`, `NOT_FOUND` ni `INTERNAL_ERROR`, que el filtro de errores sí emite; `listEpisodes` con status inválido devuelve además `BADREQUEST`.
- **`main.ts`**: el comentario junto a `enableCors()` está obsoleto (el CORS abierto desaparece con ADR 0001).
- **`apps/dashboard/docs/roadmap.md`**: sigue marcando 001/002 como bloqueantes (ya hechas), habla de "las 4 `reason`" (son 6) y plantea el showcase sobre `COMPLETED` + `.mp4` (superado por D2 y D10).

## Bitácora

- **2026-09-25** — Primera versión, escrita por `product-analyst` a partir del brief del usuario (D1-D4 fijas), `frontend-notes.md`, `apps/dashboard/docs/*`, `features.md`, `api-contract.md`, `openapi.json` y lectura puntual del código de `apps/api` y `packages/video` para confirmar el comportamiento real.
- **2026-09-25** — Revisión de `architect` integrada. De esa revisión salió el **ADR 0001** (auth con sesión emitida por Nest y Next como único origen público), que resuelve D1. Decisiones nuevas del usuario: publicación explícita (D10), `pipelineActive` (API-12), `maxTtsSegments` en `resume` (API-16). Defaults revisables: TTL de audio 3600 s (D12), "Reanudar" deshabilitado en `VALIDATION_INCONSISTENCY` (D13), sin modo degradado de nombres (D14). Hallazgos integrados: `heartbeat` SSE y timeout del proxy (API-13), `packages/video` como librería y catálogo de versiones, endpoints `/showcase` (API-7), endurecimiento de auth (API-8), mapeo de errores de proveedor (API-10b), validación de `argumentId` (API-14), orden de validación en `resume` (API-15), tareas de Turborepo y `check-boundaries`. AC 3.48 de la primera versión (imposible tal como estaba) se reemplazó por la regla real de repetición de motivo (hoy AC 3.52). Los AC se renumeraron (3.1-3.77).
- **2026-09-25** — Ajustes por la spec 004 y una decisión del usuario:
  - **`publishedAt` se adelanta a F2** (decisión del usuario): nuevo API-7a (columna + exposición en detalle y listado), bloqueante de F2; `publish`/`unpublish` y `/showcase` siguen en API-7 (F4). AC 3.17 y 3.26 pasan a poder cumplirse en F2.
  - **Idioma del debate** (spec 004, ADR 0002): D15 (`Episode.language` ES/EN/PT, default ES, inmutable); selector en "Crear episodio" (AC 3.22); `409 VOICE_NOT_CONFIGURED` al crear (AC 3.78, nuevo); distintivo de idioma en lista, detalle y showcase (AC 3.17, 3.26, 3.66, 3.67); `language` en API-1, `listEpisodes` y `listShowcaseEpisodes`; nuevo motivo `VOICE_NOT_CONFIGURED` en la tabla de resolución (AC 3.51, ahora **6 motivos**) con "Reanudar" habilitado; `lang` del documento y del contenido (AC 3.79, nuevo). Nuevos API-17 (lo entrega la 004) y API-18 (agentes sin voz, no bloqueante). La pregunta 7 queda abierta, aclarando que es el idioma de la interfaz y no el del contenido.
  - A partir de esta versión los AC y los `API-n` no se renumeran; los nuevos van al final (AC 3.78, AC 3.79) o con sufijo (API-7a).
- **2026-09-25** — Cierre de la pregunta 7 (decisión del usuario) y dos inconsistencias marcadas por `roadmap-planner`:
  - **Idioma de la interfaz del showcase**: nueva D16. El objetivo es un i18n completo (`/es`, `/en`, `/pt` y selector), independiente del idioma del debate, como nice-to-have fuera de F4. F4 sale en español con el showcase ya bajo `/[locale]` (`es` como único valor) y `/` con una redirección temporal a `/es`, de modo que ningún link compartido cambie al sumar idiomas (decidido por defecto, revisable). Cambian D8, D9, el mapa de rutas y las rutas citadas en AC 3.6, 3.15, 3.64-3.68; nuevo AC 3.80; nuevo ítem nice-to-have; pregunta 7 pasa a "Resueltas".
  - **AC 3.79 partido por fases**: (a) `lang="es"` del panel en F1; (b) contenido del debate marcado con su idioma en F2, con API-17; (c) `lang` del showcase según el `locale` de la ruta, en F4. Actualizados los rangos por fase.
  - **`lang` en el layout raíz**: en Restricciones técnicas, dos layouts raíz separados (`app/(panel)/layout.tsx` con `lang="es"` y `app/[locale]/layout.tsx` con `lang={locale}`), sin `app/layout.tsx` compartido. Verificado contra la documentación instalada de Next 16.3.6 (layout raíz, route groups, i18n, rewrites y `global-not-found`, que es experimental).
