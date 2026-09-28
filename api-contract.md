# API Contract — AI Trend Debates

Superficie HTTP del backend. Cubre P0 (creación de episodios, acciones de curaduría, updates en tiempo real) y deja marcado qué queda pendiente para P1 (Feature 9: preview con `@remotion/player`).

Autenticación: un solo usuario (el curador), con sesión por cookie emitida y validada por esta API (ADR 0001, spec 003 API-8, implementada el 2026-09-25). Todo endpoint exige sesión salvo los marcados como públicos (§1.1). No es multi-tenant: no hay usuarios, roles ni permisos por recurso.

## 1. Convenciones generales

- Formato: JSON sobre HTTP, salvo el endpoint de eventos (SSE).
- Errores: `{ "error": { "code": ErrorCode, "message": string } }`. Desde API-10 (2026-09-28), `ErrorCode` es un enum documentado en `openapi.json` y sale de una sola fuente en el código (`apps/api/src/shared/http/error-codes.ts`); un test impide que el filtro emita un código fuera del enum. Valores: `VALIDATION_ERROR`, `INVALID_SEQUENCE_INDEX`, `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE_TRANSITION`, `MANIFEST_NOT_READY`, `VOICE_NOT_CONFIGURED`, `USAGE_LIMIT_EXCEEDED`, `TOO_MANY_ATTEMPTS`, `LOGIN_BUSY`, `PROVIDER_QUOTA_EXCEEDED`, `HTTP_ERROR` e `INTERNAL_ERROR`. Una `HttpException` genérica toma el `code` de su status: 400 → `VALIDATION_ERROR`, 401 → `UNAUTHORIZED`, 403 → `FORBIDDEN`, 404 → `NOT_FOUND`, 500 → `INTERNAL_ERROR`, cualquier otro → `HTTP_ERROR` (antes usaba el nombre de la clase: `BADREQUEST`, `NOTFOUND`, que ya no existen). Un `VALIDATION_ERROR` de Zod trae en `message` el primer issue como `<campo>: <mensaje>` (`: <mensaje>` si no tiene campo); el dashboard usa ese prefijo para marcar el campo, y un e2e lo fija. `code` usa los mismos valores que `CheckpointReason` cuando aplica (`USAGE_LIMIT_EXCEEDED`, etc.), más `INVALID_STATE_TRANSITION` para acciones de curaduría llamadas en un estado que no las admite, `INVALID_SEQUENCE_INDEX` para `regenerate-audio` con un `sequenceIndex` fuera de rango (AC 6.2), `FORBIDDEN` para una URL de `/audio-files` vencida o alterada (AC 6.1), y los de auth (§1.1): `UNAUTHORIZED` (401, sin sesión válida), `INVALID_CREDENTIALS` (401, login rechazado), `TOO_MANY_ATTEMPTS` (429, login bloqueado por rate-limit) y `LOGIN_BUSY` (429, reintentar en un segundo).
- Una acción de curaduría llamada en un estado que no la admite (ver tabla de la sección 5) responde `409 Conflict`, nunca `400` — el request está bien formado, lo que falla es la transición.
- Acciones sincrónicas que llaman a un proveedor (`regenerate`, `regenerate-verdict`, `regenerate-audio`; spec 003, API-10b, implementado el 2026-09-26):
  - `409 USAGE_LIMIT_EXCEEDED`: el presupuesto del episodio (`maxLlmCalls` o `maxTtsSegments`) está agotado. En `PENDING_REVIEW` y `READY_FOR_RENDER` no hay forma de subir los límites, así que el dashboard deshabilita el botón antes de llegar a este error (AC 3.46, 3.61, 3.83).
  - `503 PROVIDER_QUOTA_EXCEEDED`: el proveedor no pudo atender la llamada: cuota diaria del LLM agotada (`DailyQuotaExceededError`), espera del limitador de RPM por encima del tope (`RateLimitWaitExceededError`) o TTS no disponible (`TtsProviderUnavailableError`); es el mismo conjunto que el pipeline convierte en el checkpoint `PROVIDER_QUOTA_EXCEEDED`. También el circuit breaker abierto (`BrokenCircuitError` de Cockatiel: tras varios fallos seguidos del proveedor, las llamadas se rechazan sin intentarse durante ~10 s), con un mensaje propio en castellano en lugar del de la librería (review F2-2). Reintentar más tarde.
  - Cualquier otra falla del proveedor sale como `500 INTERNAL_ERROR`. En todos los casos la llamada fallida no consume presupuesto y los datos quedan como estaban.
- `404 NOT_FOUND`: el recurso no existe o no pertenece al episodio del path (por ejemplo, el `argumentId` de `edit`/`regenerate`, API-14, o el `audioAssetId` de §2).

### 1.1 Autenticación (API-8, ADR 0001)

- **Topología**: la API no se expone directo al navegador; el dashboard (Next) es el único origen público y reescribe `/api/*` y `/audio-files/*` hacia la API. Por eso la API no tiene CORS, escucha por defecto solo en `127.0.0.1` (`HOST`) y confía en exactamente un proxy delante (`trust proxy` = 1). **Condición de despliegue**: el proxy de borde tiene que **agregar** `X-Forwarded-For` y Next reenviarlo (el rewrite de Next 16 no lo agrega por su cuenta). Si no, `req.ip` no identifica al cliente y del rate-limit del login solo protege el límite global (`setup.md` §3.3).
- **Sesión**: cookie `atd_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, sin `Domain`, `Secure` solo con `NODE_ENV=production`. El valor es un token sin estado `<exp>.<firma>` (HMAC-SHA256 con `SESSION_SECRET`), que vence a los 7 días del login (AC 3.3); la cookie tiene `Max-Age` igual. Cerrar sesión borra la cookie en ese navegador pero no revoca una copia hecha antes; para invalidar todas las sesiones hay que rotar `SESSION_SECRET`.
- **Qué exige sesión**: todo handler de la API, incluidos el stream SSE (§4) y `/notifications`. Son públicos solo `POST /auth/login`, `POST /auth/logout` y `GET /`; cuando exista `/showcase/*` (API-7) también lo será. Todo endpoint nuevo queda protegido por defecto (`SessionGuard` global; se abre con `@Public()`).
- **Fuera del guard** (no son handlers de Nest): `/audio-files/*` (protegido solo por su firma HMAC, porque el showcase público lo necesita), `/public/*` (estáticos) y `/docs` (Swagger), que solo se monta fuera de producción (spec 003, D20). En producción `/docs` responde 404.
- **Sin sesión válida** (falta la cookie, está alterada o venció): `401` con `code: UNAUTHORIZED`. En el SSE el `401` llega como respuesta JSON normal, antes de abrir el stream.

#### `POST /auth/login` (público)

```json
// Request
{ "username": "curador", "password": "..." }

// Response 200 + Set-Cookie: atd_session=...; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax
{ "authenticated": true, "expiresAt": "2026-10-02T16:47:06.150Z" }
```

- Credencial incorrecta: `401 INVALID_CREDENTIALS`, con el mismo mensaje sea el usuario o la contraseña (AC 3.2). No emite cookie.
- Body mal formado (falta un campo, campos extra): `400 VALIDATION_ERROR`.
- Rate-limit (AC 3.8), en memoria del proceso (reiniciar la API vacía los contadores), con ventana deslizante de 15 minutos:
  - Cada intento cuenta como fallo **desde que empieza**, antes de verificar la contraseña. Así, logins concurrentes no pueden pasar todos el chequeo antes de que se registre el primer fallo. Si el intento acierta, ese registro se deshace.
  - Con 5 intentos fallidos (o en curso) del mismo cliente (`req.ip`), o 20 en total entre todos los clientes, responde `429 TOO_MANY_ATTEMPTS` con `Retry-After` hasta que el intento más viejo salga de la ventana (hasta 900 s).
  - Si ya hay 2 verificaciones de contraseña en curso, responde `429 LOGIN_BUSY` con `Retry-After: 1` y el mensaje "Hay otro intento de inicio de sesión en curso. Reintentá en un momento.", sin contarlo como fallo. Tiene `code` propio para que el dashboard elija el mensaje por el `code`, como con el resto de los errores: `TOO_MANY_ATTEMPTS` es "esperá unos minutos" (AC 3.8) y `LOGIN_BUSY` es "reintentá ya", sin tener que interpretar `Retry-After`. Protege el threadpool de libuv, donde corre scrypt (unos 225 ms por verificación).
  - Mientras dura un bloqueo, **tampoco entra la contraseña correcta**.
  - Un login exitoso saca de las dos cuentas (cliente y global) **solo su propio intento**: no ocupa cupo, pero tampoco perdona fallos anteriores ni intentos en curso con la misma clave. Detrás del rewrite de Next el curador y un atacante pueden compartir `req.ip`, así que borrar la cuenta del cliente le perdonaría fallos al atacante. Consecuencia: los tipeos previos del propio curador siguen contando hasta salir de la ventana.
  - Ejemplo real: 50 logins incorrectos simultáneos del mismo cliente dan 5 `401` y 45 `429` (`LOGIN_BUSY` o `TOO_MANY_ATTEMPTS`, según el momento en que llega cada uno).

#### `POST /auth/logout` (público)

Responde `204` y borra la cookie (`Set-Cookie: atd_session=; Expires=Thu, 01 Jan 1970 ...`, mismos atributos). Es idempotente: no hace falta tener sesión.

#### `GET /auth/session`

Con sesión válida: `200 { "authenticated": true, "expiresAt": "..." }`. Sin sesión: `401 UNAUTHORIZED`, como cualquier endpoint protegido.

## 2. Episodes

### `POST /episodes`
Crea un episodio a partir de un tema ingresado manualmente (Feature 1 — Ingreso de Tópico). Arranca en `CREATED`.

```json
// Request
{ "topic": "Should AI replace software developers?" }

// Response 201
{
  "id": "uuid",
  "status": "CREATED",
  "topic": { "id": "uuid", "title": "Should AI replace software developers?" },
  "createdAt": "2026-08-11T00:00:00Z"
}
```

### `GET /episodes`
Lista episodios. Filtrable por estado (útil para que la interfaz de curaduría consulte solo `PENDING_REVIEW` / `REQUIRES_HUMAN_REVIEW`).

```
GET /episodes?status=PENDING_REVIEW,REQUIRES_HUMAN_REVIEW
```

```json
// Response 200, ordenado por createdAt descendente
[
  {
    "id": "uuid",
    "status": "PENDING_REVIEW",
    "title": "¿Debería la IA reemplazar a los desarrolladores de software?",
    "createdAt": "2026-09-09T00:32:30.528Z",
    "publishedAt": null
  }
]
```

`publishedAt` (spec 003, API-7a): fecha de publicación en el showcase, o `null` si no está publicado. Hoy siempre es `null`, porque las acciones `publish`/`unpublish` (API-7) todavía no existen. El `language` de cada episodio llega con la spec 004 (`tasks.md` §13.7).

### `GET /episodes/:id`
Detalle completo: estado, si hay una ejecución del pipeline en curso, tópico, participantes, uso acumulado, checkpoints, y el debate asociado (rounds, arguments oficiales, verdict si existe).

```json
{
  "id": "uuid",
  "status": "DEBATING",
  "pipelineActive": true,
  "topic": { "id": "uuid", "title": "¿Debería la IA reemplazar a los desarrolladores de software?" },
  "createdAt": "2026-09-09T00:32:30.528Z",
  "publishedAt": null,
  "participants": [
    { "agentId": "uuid", "name": "Contrarian", "role": "CONTRARIAN", "isJudge": false },
    { "agentId": "uuid", "name": "Provocateur", "role": "PROVOCATEUR", "isJudge": false },
    { "agentId": "uuid", "name": "Judge", "role": "JUDGE", "isJudge": true }
  ],
  "usage": { "llmCalls": 12, "searchRequests": 2, "ttsRequests": 0, "executionTime": 340000 },
  "limits": { "maxLlmCalls": 25, "maxSearchQueries": 5, "maxTtsSegments": 40 },
  "checkpoints": [
    { "fromState": "RESEARCHING", "reason": "INSUFFICIENT_EVIDENCE", "debateRoundId": null, "createdAt": "..." }
  ],
  "debate": {
    "rounds": [
      { "id": "uuid", "round": 1, "type": "OPENING", "arguments": [ /* status = OFFICIAL únicamente */ ] }
    ],
    "verdict": null
  }
}
```

Nota: `arguments` en este endpoint solo devuelve `status: OFFICIAL` — los `DRAFT` son estado interno de orquestación, no se exponen vía API (consistente con "los borradores están estrictamente aislados del contexto del oponente", Feature 2).

Campos agregados por la spec 003 (2026-09-25, `decision-log.md` entrada 34):

- `pipelineActive` (API-12): hay una ejecución del pipeline en curso para este episodio **en este proceso** (`runPipeline` o `runAudioPipeline`). Es estado en memoria, no una columna. Con un estado activo (`RESEARCHING`, `DEBATING`, `JUDGING`, `GENERATING_AUDIO`, ...) y `pipelineActive: false`, el episodio está trabado hasta que `EpisodeRecoveryService` lo retome al reiniciar la API (AC 3.39). Es `true` desde el mismo momento en que responden `POST /episodes`, `approve` y `resume`.
  - El flag se lee **antes** de leer el episodio. Si la ejecución termina mientras se arma la respuesta, puede salir el estado viejo con `pipelineActive: true` (nunca con `false`). La UI abre el SSE, recibe `204` y refresca; nunca queda mostrando como trabado un episodio que avanzó.
  - Caso menor en `createEpisode`: la fila `Episode` se crea (en `CREATED`) antes de que arranque el pipeline, que es cuando se marca activo. Un `GET /episodes/:id` que llegue en esa ventana, antes de que `POST /episodes` responda, ve `CREATED` con `pipelineActive: false`. En la práctica no pasa, porque el cliente recién conoce el `id` cuando `POST /episodes` respondió, y para ese momento ya está marcado. `CREATED` además dura milisegundos.
- `topic` y `createdAt` (API-1, parte 1): cabecera del detalle (AC 3.26).
- `publishedAt` (API-7a): igual que en el listado; `null` hasta que exista `publish`.
- `participants` (API-1, parte 1): los agentes del episodio, debatientes primero y el juez al final. `agentId` es el mismo que usan `arguments[].agentId`, `verdict.judgeId` y `verdict.winnerId`, así que alcanza para poner nombres en el timeline y el veredicto (AC 3.27, 3.29) e identificar al agente sin argumento aprobado en un `VALIDATION_INCONSISTENCY` (cierra API-9). `role` es la persona (`ANALYST`, `CONTRARIAN`, `DIPLOMAT`, `PROVOCATEUR`) o `JUDGE`, y `name` su nombre visible. Está vacío mientras el episodio sigue en `CREATED` (los participantes se eligen al pasar a `RESEARCHING`).
- `language` (resto de API-1) llega con la spec 004 (`tasks.md` §13.7).
- `debate.verdict.createdAt` es **el momento del debate que evaluó el juez**: el instante en que se leyeron los argumentos para juzgar, no el de la escritura del veredicto. Con `regenerate-verdict` la llamada puede tardar ~90 s o más, y un cambio hecho en ese lapso queda después de esa fecha.
- `debate.verdict.stale` (API-19, D17, implementado el 2026-09-26): `true` si algún argumento del debate se editó (`edit`) o regeneró (`regenerate`) a partir del momento que evaluó el juez, es decir, si existe un `ArgumentHistory` de un argumento del debate con `createdAt` mayor **o igual** que `verdict.createdAt` (un empate en el mismo milisegundo cuenta como desactualizado). Incluye los cambios hechos en otra pestaña mientras corría `regenerate-verdict`: en ese caso la propia respuesta de la acción ya sale con `stale: true`. No es una columna. El historial del loop de enmienda del pipeline es anterior al veredicto y no cuenta. Vuelve a `false` solo cuando `regenerate-verdict` reemplaza el veredicto (AC 3.81). Ejemplo: `"verdict": { "id": "uuid", "judgeId": "uuid", "content": "...", "winnerId": "uuid", "createdAt": "...", "stale": false }`. `verdict.id` cambia cada vez que se vuelve a juzgar.

### `GET /episodes/:id/manifest` (P0 — implementado 2026-09-24, `decision-log.md` entrada 27)
Devuelve el `RemotionManifest` (Feature 7, **P0** en `features.md` — a diferencia del worker que lo consume para producir el `.mp4`, que sí es P1/Feature 9) con URLs firmadas resueltas para cada `AudioAsset` (campo `audioUrl` en cada `timeline[]`, adicional a `audioAssetId` — no está en el JSON de ejemplo de `features.md`, que es el contrato congelado, pero sí en esta promesa de la superficie HTTP). Se genera al vuelo en cada `GET`, no se persiste. Antes de que exista audio/veredicto para todos los `Argument` OFFICIAL, devuelve `409` con `code: MANIFEST_NOT_READY` (mismo criterio: solo tiene contenido significativo desde `READY_FOR_RENDER` en adelante). El consumo vía `@remotion/player` en el frontend es la parte P1 de Feature 9, no este endpoint.

`meta.language` (spec 004, AC 4.18/4.19) es obligatorio en el contrato (`DebateLanguage`: `ES`, `EN` o `PT`; en `openapi.json`, `DebateLanguage_Output`). Hasta que exista la columna `Episode.language` (`tasks.md` §13.4) sale siempre `"ES"`; desde §13.7 sale del episodio. Ejemplo: `"meta": { "topic": "...", "language": "ES", "durationEstimatedSec": 106 }`.

### `GET /episodes/:id/audio/:audioAssetId/url`
Genera una presigned URL de corta duración para un `AudioAsset` puntual (AC 6.1) — el backend nunca devuelve `storageKey` crudo. El `audioAssetId` se scopea al episodio (`404 NOT_FOUND` si no le pertenece).

```json
// Response 200
{ "url": "/audio-files/<episodeId>/<audioAssetId>.wav?expires=<epochMs>&sig=<hmac>" }
```

Implementación real (`LocalDiskStorageProvider`, etapa 3 de TTS — `tasks.md` sección 5): la URL vence a los `AUDIO_URL_TTL_SECONDS` (default 300s) y va firmada con HMAC-SHA256 (`AUDIO_SIGNING_SECRET`) — un middleware registrado en `main.ts` (no un controller, ver `TtsModule`) verifica la firma antes de servir el archivo bajo `/audio-files/`. Vencida o alterada, `403 FORBIDDEN`.

## 3. Acciones de curaduría

Todas siguen el mismo shape: `POST /episodes/:id/actions/:action`. Cada una solo es válida desde ciertos estados (ver sección 5) — el resto del payload depende de la acción. Desde API-10 (2026-09-28), cada acción es una operación propia en `openapi.json`, con su body y su respuesta tipados: `approveEpisode`, `rejectEpisode`, `editEpisodeArgument`, `regenerateEpisodeArgument`, `resumeEpisode`, `regenerateEpisodeAudio` y `regenerateEpisodeVerdict` (las URLs no cambiaron; `runEpisodeAction` ya no existe). Todas responden `201`. Una acción desconocida responde `400 VALIDATION_ERROR`. Express 5 rutea sin distinguir mayúsculas, así que `/actions/APPROVE` ejecuta `approve` (antes daba `400`; aceptado).

### `POST /episodes/:id/actions/approve`
Válida solo desde `PENDING_REVIEW`. Sin body. Transiciona a `APPROVED`.

### `POST /episodes/:id/actions/edit`
Válida solo desde `PENDING_REVIEW`. Reescribe el contenido de un argumento puntual — dispara la trazabilidad de mutación de Feature 5 (`Origin` pasa a `Human_Edited`, la versión previa se archiva en `ArgumentHistory`).

```json
// Request
{ "argumentId": "uuid", "content": "Texto corregido por el curador." }
```

Un `argumentId` que no es de un round del debate de este episodio (o que no existe) → `404 NOT_FOUND`, sin tocar nada (API-14). Marca el veredicto como desactualizado (`debate.verdict.stale`, §2).

### `POST /episodes/:id/actions/regenerate`
Válida solo desde `PENDING_REVIEW`. Pide al agente correspondiente que regenere un argumento puntual desde cero (no es lo mismo que `Resume`: acá el episodio ya llegó completo a revisión, esto es una reescritura editorial, no una recuperación de fallo).

```json
// Request
{ "argumentId": "uuid" }
```

Sincrónica: responde cuando el agente terminó (puede esperar al limitador de RPM, hasta unos 90 s, más reintentos). Consume 1 llamada del presupuesto. Errores: `404 NOT_FOUND` si el `argumentId` no es del episodio (API-14); `409 USAGE_LIMIT_EXCEEDED` y `503 PROVIDER_QUOTA_EXCEEDED` según §1 (API-10b). En todos los casos el argumento queda como estaba. Marca el veredicto como desactualizado (§2).

### `POST /episodes/:id/actions/regenerate-audio`
Válida solo desde `READY_FOR_RENDER` (AC 6.2) — a diferencia de `edit`/`regenerate`, opera sobre audio ya sintetizado, no sobre texto en revisión. Regenera el audio de un único `sequenceIndex` (1-based, mismo orden que `timeline` del manifest) sin tocar el resto del episodio: sintetiza de nuevo con el motor activo, swapea `Argument.audioAssetId` al `AudioAsset` nuevo, y borra (best-effort) el `AudioAsset`/archivo previos.

```json
// Request
{ "sequenceIndex": 1 }

// Response 201 — el AudioAsset nuevo (AudioAssetDto)
{ "id": "uuid", "storageKey": "...", "provider": "LOCAL", "durationMs": 64812, "mimeType": "audio/wav" }
```

`sequenceIndex` fuera de rango → `400` con `code: INVALID_SEQUENCE_INDEX`. Presupuesto de TTS agotado → `409 USAGE_LIMIT_EXCEEDED`; TTS no disponible → `503 PROVIDER_QUOTA_EXCEEDED` (§1, API-10b).

### `POST /episodes/:id/actions/regenerate-verdict`
Spec 003, API-19 (D17), implementada el 2026-09-26. Válida solo desde `PENDING_REVIEW`. Vuelve a llamar al juez del episodio (su `modelProvider` asignado) con los argumentos OFFICIAL actuales y **reemplaza** el veredicto, incluido el ganador. El veredicto anterior se archiva en `VerdictHistory` (no se expone en la API). Consume 1 llamada LLM del presupuesto del episodio.

```json
// Request: body vacío, estricto (un campo de más, o no mandar body, → 400 VALIDATION_ERROR)
{}

// Response 201 — el veredicto nuevo, con el shape de debate.verdict (§2). stale es false
// salvo que alguien haya editado o regenerado un argumento mientras corría la llamada.
{ "id": "uuid", "judgeId": "uuid", "content": "...", "winnerId": "uuid", "createdAt": "...", "stale": false }
```

- **Sincrónica**: responde cuando el juez terminó; puede esperar al limitador de RPM (hasta unos 90 s) más reintentos. El cliente y el rewrite no deben cortar antes.
- **Errores**: `409 INVALID_STATE_TRANSITION` fuera de `PENDING_REVIEW`, **o si el estado cambió mientras corría la llamada al juez** (por ejemplo, se aprobó en otra pestaña; el estado se vuelve a validar justo antes de escribir, y en ese caso la llamada ya hecha sí cuenta en el presupuesto); `409 USAGE_LIMIT_EXCEEDED` y `503 PROVIDER_QUOTA_EXCEEDED` según §1; cualquier otra falla del juez, `500 INTERNAL_ERROR`. En todos los casos el veredicto anterior queda intacto.
- El archivo, el borrado del veredicto viejo y la creación del nuevo van en una sola transacción: no puede quedar el episodio sin veredicto ni con un archivo huérfano.

### `POST /episodes/:id/actions/reject`
Válida desde `PENDING_REVIEW` **o** `REQUIRES_HUMAN_REVIEW`. Sin body. Transiciona a `CANCELLED`.

### `POST /episodes/:id/actions/resume`
Válida solo desde `REQUIRES_HUMAN_REVIEW`. El body depende de la `reason` del checkpoint activo (el cliente la lee de `GET /episodes/:id`):

```json
// reason: USAGE_LIMIT_EXCEEDED
{ "maxLlmCalls": 40 }

// reason: INSUFFICIENT_EVIDENCE
{ "manualSources": [{ "url": "...", "title": "...", "snippet": "..." }] }

// reason: MAX_REVISIONS_EXCEEDED o VALIDATION_INCONSISTENCY
{}
```

El estado se valida **antes** de leer el body o aplicar límites nuevos (API-15): un `resume` fuera de `REQUIRES_HUMAN_REVIEW` responde `409 INVALID_STATE_TRANSITION` sin modificar nada.

Reanuda exactamente desde `checkpoint.fromState` / `checkpoint.debateRoundId` (ver `02-architecture/architecture.md` sección 4). Si la misma causa vuelve a ocurrir tras el resume, el episodio pasa a `FAILED` — no hay reintento automático de esa acción.

## 4. Real-time updates (SSE)

### `GET /episodes/:id/events`
`Content-Type: text/event-stream`. Eventos definidos en Feature 8 de `features.md`, más el agregado en v1.1:

```
event: research.started        data: {}
event: agent.thinking          data: { agentId, round }
event: fact_check.completed    data: { status, errorsDetected }
event: argument.approved       data: { agentId, text }   // sin sequenceIndex (API-10)
event: episode.pending_review  data: {}
event: episode.requires_review data: { reason, checkpoint }
event: heartbeat               (spec 003, API-13; sin línea data:, ver abajo)
```

El MVP transmite bloques de texto consolidado (no streaming palabra por palabra) — ver alcance definido en Feature 8.

Ciclo de vida del stream (spec 003, API-12 y API-13, implementado 2026-09-25):

- **Episodio inexistente**: `404` con `code: NOT_FOUND`, respuesta JSON normal, antes de abrir el stream (igual que `GET /episodes/:id`, AC 3.41).
- **Episodio existente sin pipeline activo** (`pipelineActive: false` en `GET /episodes/:id`): `204 No Content`, sin body y **sin** `Content-Type: text/event-stream`. No hay nada que escuchar. Para `EventSource`, un `204` significa "no reconectar": dispara `error` y queda en `CLOSED`, que es lo que pide AC 3.38 (cerrar, refrescar el detalle y reconectar solo si `pipelineActive` sigue en `true`).
- **Con pipeline activo**: entrega los eventos de negocio y además un `event: heartbeat` cada 15 s, para que el rewrite de Next (que corta a los 30 s sin bytes) no cierre la conexión (AC 3.33). El heartbeat no es un evento de negocio: la UI no lo muestra en el feed ni refresca el detalle con él. Cuando termina la ejecución (éxito, checkpoint o error), el stream se cierra.
- **Cabeceras**: `Content-Type: text/event-stream`, `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0, no-transform` y `X-Accel-Buffering: no`. Las pone Nest 11 en todo `@Sse`; `no-transform` es lo que pide API-13, para que ningún proxy comprima o bufferee el stream.
- **Eventos sin payload** (decisión del usuario, 2026-09-25): `research.started` y `episode.pending_review` salen con una línea `data: {}` (por ejemplo, `event: research.started` / `id: 1` / `data: {}`). Sin esa línea `EventSource` no los despacha, porque según el estándar de SSE descarta un evento con el buffer de datos vacío. El `heartbeat`, en cambio, sale a propósito **sin** línea `data:`: `EventSource` no lo despacha y nunca llega a un listener ni al feed (AC 3.33). Solo sirve para que pasen bytes por el rewrite.

## 5. Tabla de estados válidos por acción

| Acción | Estados válidos de origen |
|---|---|
| `approve` | `PENDING_REVIEW` |
| `edit` | `PENDING_REVIEW` |
| `regenerate` | `PENDING_REVIEW` |
| `reject` | `PENDING_REVIEW`, `REQUIRES_HUMAN_REVIEW` |
| `resume` | `REQUIRES_HUMAN_REVIEW` |
| `regenerate-audio` | `READY_FOR_RENDER` |
| `regenerate-verdict` | `PENDING_REVIEW` (spec 003, API-19; también `409` si el estado cambia mientras corre la llamada al juez) |

Cualquier llamada fuera de esta tabla → `409 Conflict` con `code: INVALID_STATE_TRANSITION`.
## 6. Notificaciones (inbox)

Inbox persistente del curador, complementario al SSE (`decision-log.md` entrada 9): el dashboard lo consulta por polling (spec 003, D6). Todas exigen sesión. Respuestas documentadas en `openapi.json` desde el 2026-09-25 (spec 003, API-5).

### `GET /notifications?unreadOnly=true`

`unreadOnly` es `true` por defecto; con `false` trae también las leídas. Ordenadas por `createdAt` descendente, sin paginación.

```json
// Response 200
[
  {
    "id": "uuid",
    "episodeId": "uuid",
    "type": "EPISODE_PENDING_REVIEW",
    "message": "El episodio está listo para revisión.",
    "readAt": null,
    "createdAt": "2026-09-09T14:29:48.129Z"
  }
]
```

- `type`: `EPISODE_COMPLETED`, `EPISODE_PENDING_REVIEW`, `EPISODE_REQUIRES_REVIEW` o `EPISODE_FAILED`.
- `message`: texto ya armado al crear la notificación; el front no lo deriva de `type`.
- `readAt`: `null` si no está leída.

### `POST /notifications/:id/read`

Marca una notificación como leída. Responde `201` con la notificación completa (mismo shape que un ítem del listado), con `readAt` ya seteado. Un `id` inexistente da `404 NOT_FOUND`.

### `POST /notifications/read-all`

Marca como leídas todas las no leídas. Responde `201` con la cantidad que marcó:

```json
{ "count": 3 }
```

Hasta el 2026-09-25 respondía `201` sin body; el `{ count }` se agregó para que la respuesta tenga un schema (API-5).
