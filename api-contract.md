# API Contract — AI Trend Debates

Superficie HTTP del backend. Cubre P0 (creación de episodios, acciones de curaduría, updates en tiempo real) y deja marcado qué queda pendiente para P1 (Feature 9: preview con `@remotion/player`).

Alcance de este MVP: sin autenticación — es una herramienta de uso local/personal, no multi-tenant. Si en algún momento se expone públicamente, esto es lo primero que hay que agregar.

## 1. Convenciones generales

- Formato: JSON sobre HTTP, salvo el endpoint de eventos (SSE).
- Errores: `{ "error": { "code": string, "message": string } }`. `code` usa los mismos valores que `CheckpointReason` cuando aplica (`USAGE_LIMIT_EXCEEDED`, etc.), más `INVALID_STATE_TRANSITION` para acciones de curaduría llamadas en un estado que no las admite, `INVALID_SEQUENCE_INDEX` para `regenerate-audio` con un `sequenceIndex` fuera de rango (AC 6.2), y `FORBIDDEN` para una URL de `/audio-files` vencida o alterada (AC 6.1).
- Una acción de curaduría llamada en un estado que no la admite (ver tabla de la sección 5) responde `409 Conflict`, nunca `400` — el request está bien formado, lo que falla es la transición.

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

### `GET /episodes/:id`
Detalle completo: estado, uso acumulado, checkpoints, y el debate asociado (rounds, arguments oficiales, verdict si existe).

```json
{
  "id": "uuid",
  "status": "DEBATING",
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

### `GET /episodes/:id/manifest` (P1)
Devuelve el `RemotionManifest` (Feature 7) con URLs firmadas resueltas para cada `AudioAsset`, para consumo de `@remotion/player` en el frontend. Solo tiene contenido significativo desde `READY_FOR_RENDER` en adelante.

### `GET /episodes/:id/audio/:audioAssetId/url`
Genera una presigned URL de corta duración para un `AudioAsset` puntual (AC 6.1) — el backend nunca devuelve `storageKey` crudo. El `audioAssetId` se scopea al episodio (`404 NOT_FOUND` si no le pertenece).

```json
// Response 200
{ "url": "/audio-files/<episodeId>/<audioAssetId>.wav?expires=<epochMs>&sig=<hmac>" }
```

Implementación real (`LocalDiskStorageProvider`, etapa 3 de TTS — `tasks.md` sección 5): la URL vence a los `AUDIO_URL_TTL_SECONDS` (default 300s) y va firmada con HMAC-SHA256 (`AUDIO_SIGNING_SECRET`) — un middleware registrado en `main.ts` (no un controller, ver `TtsModule`) verifica la firma antes de servir el archivo bajo `/audio-files/`. Vencida o alterada, `403 FORBIDDEN`.

## 3. Acciones de curaduría

Todas siguen el mismo shape: `POST /episodes/:id/actions/:action`. Cada una solo es válida desde ciertos estados (ver sección 5) — el resto del payload depende de la acción.

### `POST /episodes/:id/actions/approve`
Válida solo desde `PENDING_REVIEW`. Sin body. Transiciona a `APPROVED`.

### `POST /episodes/:id/actions/edit`
Válida solo desde `PENDING_REVIEW`. Reescribe el contenido de un argumento puntual — dispara la trazabilidad de mutación de Feature 5 (`Origin` pasa a `Human_Edited`, la versión previa se archiva en `ArgumentHistory`).

```json
// Request
{ "argumentId": "uuid", "content": "Texto corregido por el curador." }
```

### `POST /episodes/:id/actions/regenerate`
Válida solo desde `PENDING_REVIEW`. Pide al agente correspondiente que regenere un argumento puntual desde cero (no es lo mismo que `Resume`: acá el episodio ya llegó completo a revisión, esto es una reescritura editorial, no una recuperación de fallo).

```json
// Request
{ "argumentId": "uuid" }
```

### `POST /episodes/:id/actions/regenerate-audio`
Válida solo desde `READY_FOR_RENDER` (AC 6.2) — a diferencia de `edit`/`regenerate`, opera sobre audio ya sintetizado, no sobre texto en revisión. Regenera el audio de un único `sequenceIndex` (1-based, mismo orden que `timeline` del manifest) sin tocar el resto del episodio: sintetiza de nuevo con el motor activo, swapea `Argument.audioAssetId` al `AudioAsset` nuevo, y borra (best-effort) el `AudioAsset`/archivo previos.

```json
// Request
{ "sequenceIndex": 1 }

// Response 200 — el AudioAsset nuevo
{ "id": "uuid", "storageKey": "...", "provider": "LOCAL", "durationMs": 64812, "mimeType": "audio/wav" }
```

`sequenceIndex` fuera de rango → `400` con `code: INVALID_SEQUENCE_INDEX`.

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

Reanuda exactamente desde `checkpoint.fromState` / `checkpoint.debateRoundId` (ver `02-architecture/architecture.md` sección 4). Si la misma causa vuelve a ocurrir tras el resume, el episodio pasa a `FAILED` — no hay reintento automático de esa acción.

## 4. Real-time updates (SSE)

### `GET /episodes/:id/events`
`Content-Type: text/event-stream`. Eventos definidos en Feature 8 de `features.md`, más el agregado en v1.1:

```
event: research.started
event: agent.thinking          data: { agentId, round }
event: fact_check.completed    data: { status, errorsDetected }
event: argument.approved       data: { sequenceIndex, agentId, text }
event: episode.pending_review
event: episode.requires_review data: { reason, checkpoint }
```

El MVP transmite bloques de texto consolidado (no streaming palabra por palabra) — ver alcance definido en Feature 8.

## 5. Tabla de estados válidos por acción

| Acción | Estados válidos de origen |
|---|---|
| `approve` | `PENDING_REVIEW` |
| `edit` | `PENDING_REVIEW` |
| `regenerate` | `PENDING_REVIEW` |
| `reject` | `PENDING_REVIEW`, `REQUIRES_HUMAN_REVIEW` |
| `resume` | `REQUIRES_HUMAN_REVIEW` |
| `regenerate-audio` | `READY_FOR_RENDER` |

Cualquier llamada fuera de esta tabla → `409 Conflict` con `code: INVALID_STATE_TRANSITION`.