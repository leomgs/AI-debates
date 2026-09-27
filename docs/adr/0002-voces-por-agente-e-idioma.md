# 0002: Voces TTS por agente, idioma y proveedor en la tabla `AgentVoice`

Estado: **aceptado** (2026-09-25). Origen: spec `docs/product/004-debate-language.md`, D6/D7. Lo propuso el agente `architect` en su revisión de la spec 004 y lo aceptó el usuario. Reemplaza el punto 1 de `decision-log.md` #20, que guardaba en `Agent.voiceId` un `Json` con shape `Record<provider, string>`.

## Contexto

- La spec 004 pide una voz por agente, idioma (`ES`/`EN`/`PT`) y proveedor, sin ningún respaldo silencioso (D6). También pide que `createEpisode` rechace un idioma que no tiene voces para el proveedor activo (D7).
- `TtsService.resolveVoiceId` castea el `Json` sin validarlo (`apps/api/src/modules/tts/tts.service.ts:122-126`).
- Los tests guardan un string suelto (`episodes.integration.spec.ts:46`) y el seed carga placeholders `"TBD"` (`prisma/seed.ts:31-36`).
- Si recibe `voice: undefined`, Echogarden detecta el idioma del texto y elige otra voz sin dar error (`echogarden/dist/api/Synthesis.js:42-73`). Los nombres de voz se buscan por prefijo (`:1054-1073`).

## Decisión

1. Un enum `DebateLanguage { ES EN PT }`, compartido por `Episode.language` y `AgentVoice.language`. Su equivalente en Zod es `DebateLanguageSchema`; vive en `packages/contracts` y lo usa también el `RemotionManifest` (`meta.language`).
2. Una tabla `AgentVoice(agentId, language, provider: AudioProvider, voiceId)`, con `@@id([agentId, language, provider])` y `onDelete: Cascade`. Se elimina `Agent.voiceId`.
3. Una voz que no se verificó no se inserta. Que falte la fila es la única forma de representar "sin voz".
4. `TtsService.resolveVoiceId(agent, language)` y `assertVoicesConfigured(agentIds, language)` lanzan `VoiceNotConfiguredError`, y `createEpisode` llama a la segunda antes del primer insert. Mapeo del error:
   - en HTTP, `409 VOICE_NOT_CONFIGURED`;
   - en el pipeline, `REQUIRES_HUMAN_REVIEW` con el `CheckpointReason` nuevo `VOICE_NOT_CONFIGURED`, que se reanuda con body vacío.
5. Mientras exista un solo `AudioProvider` enlazado (Echogarden), el arranque falla si `TTS_PROVIDER !== LOCAL`. La clave de voz y la validación salen de la misma fuente que el proveedor enlazado.
6. `AudioAsset.voiceId String?` guarda la voz realmente usada. Así el manifest de un episodio ya sintetizado no cambia de voz si después se modifica el seed. Para los assets viejos (`null`), se usa la resolución por idioma.
7. La migración se escribe a mano y se aplica con `migrate deploy` (#21). Hace cuatro cosas:
   - copia las entradas actuales como `ES` con `json_each`, excluyendo `TBD`;
   - reconstruye `Agent` sin `voiceId`;
   - agrega `Episode.language DEFAULT 'ES'`;
   - agrega `AudioAsset.voiceId` y lo completa en los assets existentes con la voz `LOCAL` que tenía su agente al momento de migrar (spec 004, pregunta B, decisión del usuario).

## Consecuencias

- (+) El ORM valida idioma y proveedor, y la PK garantiza la unicidad. D7 se resuelve con una sola consulta.
- (+) La migración conserva exactamente las voces españolas actuales.
- (+) Un episodio publicado mantiene su voz aunque cambie el seed.
- (−) La migración reconstruye la tabla `Agent`. Cambian el seed, `TtsService`, `EpisodesService.getManifest` y los tests que crean agentes.
- (−) El valor nuevo de `CheckpointReason` obliga a actualizar el DTO, `openapi.json` y la tabla de resolución §7 de la spec 003.
- (−) La descarga de un modelo de voz sin red sigue saliendo como `PROVIDER_QUOTA_EXCEEDED`. Es un problema previo, que queda fuera de alcance.

## Alternativas consideradas

- **Json anidado `Record<lang, Record<provider, string>>` en `Agent.voiceId`**: la migración sería solo de datos, sin reconstruir la tabla. A cambio, exige parsear con Zod en dos niveles en cada lectura y no distingue un placeholder de una voz real.
- **Json `Record<provider, Record<lang, string>>`**: tiene los mismos problemas, y además el chequeo de D7 tiene que recorrer todas las entradas de un proveedor.
- **Usar la voz `ES` como respaldo**: descartado por D6, porque produce audio inservible sin ningún error.

## Notas posteriores

- **2026-09-27**: las referencias "spec 004, D6/D7" de Contexto, Consecuencias y Alternativas corresponden a la numeración de la primera versión de la spec; hoy son D14 (sin respaldo silencioso) y D15 (`VOICE_NOT_CONFIGURED`). Por decisión del usuario (spec 004, D20), en el MVP `AgentVoice` solo tiene filas `ES`; `EN` y `PT` quedan en el enum y se rechazan con el `409` del punto 4 hasta que la mejora "Voces EN/PT" cargue sus voces. No cambia ninguna decisión de este ADR.
- **2026-09-27 (revisión de 13.6)**: reemplaza la segunda frase del punto 6. El manifest ya no resuelve por idioma los agentes sin voz guardada: informa `voiceId: null` (el juez, que no tiene segmentos, y los assets que quedaron en `null` tras el backfill). Motivo: la resolución por idioma leía `AgentVoice` actual, así que un cambio en el seed alteraba el manifest de episodios ya sintetizados (contra el objetivo del propio punto 6) y un borrado hacía responder `409 VOICE_NOT_CONFIGURED` a un episodio `READY_FOR_RENDER`, incluido el showcase público. `RemotionManifestAgentSchema.voiceId` pasa a nullable (spec 004, D17, AC 4.16); se implementa en el paso 13.7. La resolución por idioma queda solo para sintetizar (punto 4).
