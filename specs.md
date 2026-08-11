AI Trend Debates — Feature Specification
Versión: 1.1
Objetivo: MVP de una plataforma de generación de debates audiovisuales automatizados, verificados, controlados en costo y curados por humanos.

Changelog 1.1: se introduce el modelo de recuperación (checkpoint + REQUIRES_HUMAN_REVIEW) para distinguir interrupciones recuperables de fallos terminales. Afecta Features 1, 2, 4 y 5.

1. Trend Discovery & Research (P0)
Objetivo: Construir una base de evidencia (Evidence Base) aislada, confiable y fechada antes de inicializar la orquestación del debate.
Funcionalidades Refinadas
Ingreso de Tópico: Entrada manual por string de texto (Topic) por parte del usuario.
Búsqueda Automatizada: Consumo asíncrono de proveedores de motores de búsqueda web.
Recolección Extendida de Fuentes: Extracción obligatoria de metadatos: URL, Title, Snippet, Fetch_Timestamp, Published_At (si está disponible) y un Content_Hash (identificador único del contenido recuperado para detectar mutaciones o duplicados).
Generación de la Base de Evidencia: Consolidación de datos estructurados (Facts, Data_Points) vinculados estrictamente a sus fuentes de origen mediante relaciones de base de datos.
Criterios de Aceptación (AC)
AC 1.1: Aislamiento criptográfico o lógico estricto de la Evidence Base por cada episodio.
AC 1.2: Toda afirmación extraída debe mantener trazabilidad hacia el Content_Hash y la URL de origen.
Casos Límite (Edge Cases)
Si la búsqueda retorna menos de 3 fuentes válidas con hashes de contenido distintos, el episodio transiciona a REQUIRES_HUMAN_REVIEW con el motivo INSUFFICIENT_EVIDENCE (ver Feature 4). No es un fallo terminal: un curador puede inyectar fuentes manuales a la Evidence Base o ampliar los parámetros de búsqueda, y reanudar desde el checkpoint RESEARCHING. Solo transiciona a FAILED si, tras el reintento post-revisión humana, sigue sin alcanzar el mínimo de 3 fuentes.

2. Debate Orchestration & Cost Control (P0)
Objetivo: Administrar el ciclo de vida interactivo de los agentes (turnos, prompts e inyección de contexto) e imponer barreras operacionales implacables para evitar el descontrol de costos en la nube.
Funcionalidades Refinadas
Límites Operacionales por Episodio (Cost/Usage Control): Cada episodio nace con un presupuesto máximo de ejecución. Si se excede cualquiera de estos techos, el pipeline se congela y transiciona a un estado de error controlado.
Estructura de Consumo (EpisodeUsage): El sistema registrará de forma transaccional: llmCalls, inputTokens, outputTokens, searchRequests, ttsRequests y executionTime.
Promoción de Argumentos: Los agentes solo pueden leer intervenciones que tengan el estado OFFICIAL. Los borradores (DRAFT) están estrictamente aislados del contexto del oponente.
Techos Máximos del MVP (Configurables)
max_llm_calls_per_episode: 25
max_search_queries_per_episode: 5
max_tts_segments_per_episode: 40
max_revision_attempts_per_draft: 3
Criterios de Aceptación (AC)
AC 2.1: Antes de cada llamada a un LLM o proveedor de TTS, el orquestador verificará que el acumulado en EpisodeUsage no supere el límite configurado. De superarlo, detendrá el flujo y mutará el estado a REQUIRES_HUMAN_REVIEW bajo la causa USAGE_LIMIT_EXCEEDED, persistiendo un checkpoint con el estado exacto en que se congeló (ver Feature 4). Superar el presupuesto no es un error de sistema: es una decisión de negocio que un curador puede resolver ampliando el límite y reanudando, o rechazando el episodio (Reject → CANCELLED).

3. Real-Time Fact Checking & Content Validation (P0)
Objetivo: Analizar, categorizar y validar las afirmaciones del agente, asegurando que los claims factuales sean verdaderos y que el contenido no factual respete las reglas editoriales.
Flujo de Filtros y Clasificación
                  ┌─────────────── DRAFT ───────────────┐
                   │                                     │
                   ▼                                     ▼
           [CLAIMS FACTUALES]                  [OPINIONES / PREDICCIONES]
                   │                                     │
                   ▼                                     ▼
        [Fact-Checking Estricto]              [Filtro Editorial / Persona]
     (TRUE, FALSE, MISLEADING, etc.)             (Estilo, Tono, Reglas)

Funcionalidades Refinadas
Claim Extraction: Segmentación del DRAFT en afirmaciones discretas clasificadas en: FACTUAL, OPINION, PREDICTION, o SUBJECTIVE.
Enrutamiento de Validación:
FACTUAL: Pasa al motor de Fact-Checking contra los vectores/textos de la Evidence Base (Resultados: TRUE, FALSE, MISLEADING, UNSUPPORTED, CONTESTED).
OPINION / PREDICTION / SUBJECTIVE: Quedan eximidos del fact-checking factual, pero se someten a un evaluador secundario ágil (Filtro Editorial) que valida que no violen la personalidad (persona) del agente ni las reglas de moderación (ej. insultos directos).
Loop de Enmienda: Si el borrador falla por un claim FALSE / MISLEADING o por romper las reglas de personalidad, se envía feedback estructurado al agente. Máximo 3 reintentos antes de derivar a intervención humana.

4. Debate State & Episode Lifecycle (P0)
Objetivo: Persistir la máquina de estados de forma transaccional, garantizando idempotencia y una clara distinción entre fallos recuperables, fallos terminales, cancelaciones de usuarios y revisiones.
Máquina de Estados Definitiva (v1.1)
[CREATED] ──► [RESEARCHING] ──► [READY_FOR_DEBATE] ──► [DEBATING] ──► [JUDGING] ──► [PENDING_REVIEW]
                                                                                          │
   ┌───────────────────────────────────┬──────────────────────────────────────────────────┤
   ▼                                   ▼                                                  ▼
[FAILED]                          [CANCELLED]                                         [APPROVED]
(terminal, no                     (Cancelado por                                          │
 recuperable)                      curador humano)                                        ▼
                                                                                  [GENERATING_AUDIO]
                                                                                          │
                                                                                          ▼
[COMPLETED] ◄── [RENDERING] ◄── [READY_FOR_RENDER] ◄──────────────────────────────────────┘

Estado Transversal Recuperable: REQUIRES_HUMAN_REVIEW
A diferencia de FAILED, este estado NO descarta el progreso del episodio. Se gatilla desde cualquier estado activo (RESEARCHING, DEBATING, JUDGING) por alguna de estas causas:
  - INSUFFICIENT_EVIDENCE: menos de 3 fuentes válidas (Feature 1).
  - USAGE_LIMIT_EXCEEDED: se superó algún techo de EpisodeUsage (Feature 2).
  - MAX_REVISIONS_EXCEEDED: un agente agotó sus max_revision_attempts en el loop de fact-checking (Feature 3).
  - VALIDATION_INCONSISTENCY: inconsistencia en validación intermedia que no rompe el backend pero requiere árbitro humano.

Al entrar a REQUIRES_HUMAN_REVIEW, el sistema persiste un Checkpoint: { fromState: EpisodeState, reason: string, snapshot: EpisodeUsage }. El curador resuelve mediante una de estas acciones (ver Feature 5):
  - Resume: reanuda la ejecución exactamente desde checkpoint.fromState (por ejemplo, ampliar el presupuesto y continuar DEBATING donde quedó, o agregar fuentes manuales y continuar RESEARCHING).
  - Reject: transiciona a CANCELLED (decisión humana de no continuar).
  - Escalar a FAILED: si tras un Resume la misma causa vuelve a ocurrir (ej. sigue sin alcanzar 3 fuentes tras la revisión), el episodio pasa a FAILED como terminal — no hay un tercer intento automático.

FAILED sigue siendo estrictamente terminal y reservado para: (a) errores de sistema no clasificables (excepción no controlada, proveedor caído sin fallback vía Cockatiel), o (b) una causa de REQUIRES_HUMAN_REVIEW que persiste después de un Resume.

Idempotencia: cubre dos escenarios distintos con el mismo mecanismo de Checkpoint —
  1. Reanudación poscaída del proceso: el sistema inspecciona el último estado persistido y sus assets asociados. Si el estado es GENERATING_AUDIO, se asume el guion como de solo lectura y se retoman exclusivamente las llamadas de audio pendientes.
  2. Reanudación post-decisión-humana (Resume): idéntico mecanismo, pero el trigger es la acción explícita del curador en vez de un restart del proceso.

5. Human-in-the-Loop / Episode Curation (P0)
Objetivo: Interfaz de bloqueo operacional que congela el pipeline en el estado PENDING_REVIEW para la validación, reescritura o descarte del episodio.
Funcionalidades Refinadas
Acciones de Curaduría en PENDING_REVIEW: Approve, Edit, Regenerate, Reject (muta a CANCELLED).
Acciones de Curaduría en REQUIRES_HUMAN_REVIEW (Feature 4): Resume (reanuda desde el Checkpoint persistido, tras resolver la causa — ampliar presupuesto, agregar evidencia manual, etc.), Reject (muta a CANCELLED).
Trazabilidad de Mutación: El payload de los argumentos posee la propiedad Origin. Si el usuario modifica un texto, el origen cambia a Human_Edited y se almacena la versión previa con origen AI_Generated en la colección histórica (Feature 10).

6. TTS & Abstracción de Almacenamiento de Audio (P0)
Objetivo: Transformar los textos en diálogos hablados de forma asíncrona, aislando el software de la infraestructura física de almacenamiento.
Abstracción de Capa de Almacenamiento
El backend no almacenará URLs públicas crudas en las entidades de negocio. Toda interacción con archivos de voz utilizará una estructura de datos abstracta (AudioAsset):
AudioAsset
├── id: string (UUID)
├── storageKey: string (ej: "episodes/45/segment_12.mp3")
├── provider: string (ej: "ELEVENLABS", "OPENAI", "LOCAL")
├── durationMs: number
└── mimeType: string (ej: "audio/mpeg")

Criterios de Aceptación (AC)
AC 6.1: El backend expondrá un servicio interno o generador de URLs firmadas temporales (Presigned URLs) bajo demanda cuando el Frontend o el manifest de Remotion lo requieran, abstrayendo si el almacenamiento subyacente es un disco local, AWS S3, Cloudflare R2 o Google Cloud Storage.
AC 6.2: Soporte nativo para la regeneración atómica de un único sequenceIndex de audio, actualizando su storageKey y durationMs sin alterar el resto de los componentes del episodio.

7. Remotion Manifest & Sincronización del Timing (P0)
Objetivo: Generar el contrato de renderizado eliminando ambigüedades entre tiempos estimados (pre-TTS) y reales (post-TTS).
Contrato Estricto (RemotionManifest)
Se eliminan las propiedades ambiguas. durationEstimatedSec pasa a ser estrictamente un metadato informativo generado al inicio. El timeline se rige al 100% por milisegundos calculados directamente de los assets de audio reales creados en la Feature 6.
json
{
  "episodeId": "string (UUID)",
  "meta": {
    "topic": "string",
    "durationEstimatedSec": 120 
  },
  "agents": [
    { "id": "A", "name": "Agente Alfa", "avatarUrl": "string", "voiceId": "string" }
  ],
  "timeline": [
    {
      "sequenceIndex": 1,
      "agentId": "A",
      "text": "Contenido definitivo del argumento.",
      "audioAssetId": "string (UUID)",
      "durationMs": 4500,
      "subtitles": [
        { "text": "Contenido", "startMs": 0, "endMs": 1000 },
        { "text": "definitivo", "startMs": 1001, "endMs": 2500 }
      ]
    }
  ],
  "verdict": {
    "winnerAgentId": "A",
    "summary": "string"
  }
}


8. Real-Time Episode Updates via SSE (P0)
Objetivo: Proveer notificaciones push de eventos de estado concretos al cliente para eliminar el polling.
Alcance del MVP (Eventos de Bloque Completo)
Para simplificar el desarrollo inicial y priorizar la estabilidad del Fact-Checker, el MVP transmitirá eventos de bloque de texto consolidado una vez aprobados, posponiendo el streaming palabra por palabra para fases futuras.
event: "research.started"      -> Notifica el inicio del scraping.
event: "agent.thinking"         -> Payload: { agentId: "X", round: 1 }
event: "fact_check.completed"   -> Payload: { status: "TRUE/FALSE", errorsDetected: 0 }
event: "argument.approved"      -> Payload: { sequenceIndex: 1, agentId: "X", text: "Texto completo aprobado" }
event: "episode.pending_review" -> Habilita la intervención del curador en la interfaz web.
event: "episode.requires_review" -> Payload: { reason: "INSUFFICIENT_EVIDENCE/USAGE_LIMIT_EXCEEDED/MAX_REVISIONS_EXCEEDED/VALIDATION_INCONSISTENCY", checkpoint: EpisodeState }


9. Video Rendering & Preview (P1)
Frontend (P1): Consumo del RemotionManifest mediante @remotion/player para previsualización inmediata en el navegador mediante la resolución de URLs firmadas de los audios.
Backend Workers (P1): Microservicio desacoplado encargado de tomar el JSON del manifest, ejecutar el binario de Remotion y procesar el .mp4 definitivo.

10. Auditability & Data Model Storage (P1)
Estrategia: La interfaz de usuario para auditar es un P1. Sin embargo, el modelo de datos se implementará desde el día uno (P0) para recopilar de forma silenciosa la información de los Prompts, los Rejected Drafts y el desglose de los análisis del Fact-Checker con sus respectivas fuentes asociadas. Ningún dato intermedio de la IA se descarta en caliente.

Versión 1.0 — CONGELADA ❄️
El alcance está perfectamente acotado, los riesgos financieros controlados y las abstracciones técnicas en su lugar.