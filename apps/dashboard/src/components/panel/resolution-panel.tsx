"use client";

import { Play } from "lucide-react";
import { useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { checkpointReasonLabel, type CheckpointReason } from "@/lib/checkpoint-reasons";
import { debateLanguageLabel } from "@/lib/debate-language";
import { checkpointRound, roundLabel, type Checkpoint, type EpisodeDetail } from "@/lib/episode-detail";
import { episodeStatusUi } from "@/lib/episode-status";
import {
  EMPTY_RESUME_BODY,
  agentsToReviewForVoices,
  agentsWithoutOfficialArguments,
  isKnownReason,
  type ActiveResolution,
} from "@/lib/resume-resolution";
import { ManualSourcesResolution } from "./manual-sources-resolution";
import { RejectButton } from "./reject-button";
import { RepeatReasonWarning, ResumeButton, ResumeError, useResumeFailure } from "./resume-controls";
import { UsageLimitResolution } from "./usage-limit-resolution";
import type { EpisodeActions } from "./use-episode-actions";

/**
 * Panel de resolución de REQUIRES_HUMAN_REVIEW (sección 7; AC 3.51-3.55),
 * arriba de todo en el detalle: el motivo del checkpoint más reciente en
 * lenguaje claro, dónde se frenó y lo que se puede hacer para ese motivo.
 * "Rechazar" está siempre. Tras reanudar con éxito, el refetch trae la fase
 * activa, el panel desaparece y la vista en vivo vuelve sola a SSE o a
 * polling (AC 3.53).
 */
export function ResolutionPanel({
  detail,
  resolution,
  actions,
}: {
  detail: EpisodeDetail;
  resolution: ActiveResolution;
  actions: EpisodeActions;
}) {
  // Destino del foco mientras corre Rechazar. Con el éxito o un 409 el panel
  // se desmonta y useEpisodeActions lleva el foco al <h1> o al aviso de
  // pantalla (AC 3.77); lo mismo tras reanudar.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const { checkpoint } = resolution;

  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded-lg border border-primary/50 bg-card p-4">
      <div className="space-y-1">
        <h2 id={headingId} ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
          El episodio necesita tu intervención
        </h2>
        {checkpoint ? <CheckpointSummary checkpoint={checkpoint} detail={detail} /> : null}
      </div>
      {/* La key reinicia los formularios si llega un checkpoint nuevo. */}
      <ResolutionBody
        key={checkpoint?.createdAt ?? "sin-checkpoint"}
        detail={detail}
        resolution={resolution}
        actions={actions}
      />
      <div className="border-t pt-4">
        <RejectButton actions={actions} focusAfterConfirm={() => headingRef.current} />
      </div>
    </section>
  );
}

function CheckpointSummary({ checkpoint, detail }: { checkpoint: Checkpoint; detail: EpisodeDetail }) {
  const round = checkpointRound(detail.debate.rounds, checkpoint);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Motivo</dt>
      <dd className="font-medium">{checkpointReasonLabel(checkpoint.reason)}</dd>
      <dt className="text-muted-foreground">Se frenó en</dt>
      <dd>
        {episodeStatusUi(checkpoint.fromState).label}
        {round !== null && ` · ${roundLabel(round)}`}
      </dd>
    </dl>
  );
}

function ResolutionBody({
  detail,
  resolution,
  actions,
}: {
  detail: EpisodeDetail;
  resolution: ActiveResolution;
  actions: EpisodeActions;
}) {
  const { checkpoint, kind } = resolution;
  // Un motivo desconocido o sin checkpoint no sabe qué body mandar (AC 3.55).
  if (checkpoint === null || kind === "unknown" || !isKnownReason(checkpoint.reason)) {
    return <UnknownReason reason={checkpoint?.reason ?? null} />;
  }
  switch (kind) {
    case "usage-limit":
      return <UsageLimitResolution detail={detail} checkpoint={checkpoint} actions={actions} />;
    case "insufficient-evidence":
      return <ManualSourcesResolution actions={actions} />;
    case "blocked":
      return <ValidationInconsistency detail={detail} />;
    case "empty":
      return (
        <div className="space-y-4">
          <EmptyBodyExplanation reason={checkpoint.reason} detail={detail} />
          <EmptyBodyResume reason={checkpoint.reason} actions={actions} />
        </div>
      );
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** Lo que explica la UI para los motivos que se reanudan con `{}` (tabla de AC 3.51). */
function EmptyBodyExplanation({ reason, detail }: { reason: CheckpointReason; detail: EpisodeDetail }) {
  switch (reason) {
    case "MAX_REVISIONS_EXCEEDED":
      return (
        <p className="text-sm">
          Un agente agotó sus intentos de revisión en el fact-checking: el verificador siguió encontrando errores en su
          argumento. Al reanudar, el debate sigue desde donde se frenó.
        </p>
      );
    case "PROVIDER_QUOTA_EXCEEDED":
      return (
        <div className="space-y-2 text-sm">
          <p>
            Se agotó la cuota del proveedor externo (el modelo de lenguaje) o el proveedor de audio no está disponible.
            No es el presupuesto del episodio: subir límites no sirve.
          </p>
          <p className="text-muted-foreground">
            La cuota diaria del modelo de lenguaje se mide en una ventana deslizante de 24 horas. Reanudá cuando estimes
            que el proveedor se recuperó.
          </p>
        </div>
      );
    case "VOICE_NOT_CONFIGURED":
      return <VoiceNotConfigured detail={detail} />;
    default:
      return null;
  }
}

function VoiceNotConfigured({ detail }: { detail: EpisodeDetail }) {
  const agents = agentsToReviewForVoices(detail);
  return (
    <div className="space-y-2 text-sm">
      <p>
        Falta al menos una voz de audio para el idioma del episodio (
        <span className="font-medium">{debateLanguageLabel(detail.language)}</span>) en el proveedor de audio activo.
      </p>
      <p>
        El panel todavía no sabe qué agente no tiene voz; revisá las voces de estos participantes para ese idioma:
      </p>
      <ul className="list-disc pl-5">
        {agents.map((agent) => (
          <li key={agent.agentId}>
            {agent.name}
            {agent.isJudge && <span className="text-muted-foreground"> (juez)</span>}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        Las voces se corrigen en el seed de voces de la API, fuera del dashboard. A diferencia de otros motivos, acá
        reanudar sí resuelve, siempre que antes se hayan corregido las voces.
      </p>
    </div>
  );
}

/** "Reanudar" con body `{}` (AC 3.53), con su aviso de repetición (AC 3.52). */
function EmptyBodyResume({ reason, actions }: { reason: CheckpointReason; actions: EpisodeActions }) {
  const warningId = useId();
  const failure = useResumeFailure(actions);
  return (
    <div className="space-y-3">
      <ResumeError failure={failure} />
      <RepeatReasonWarning reason={reason} id={warningId} />
      <ResumeButton
        actions={actions}
        describedBy={warningId}
        onResume={() => actions.run({ action: "resume", body: EMPTY_RESUME_BODY })}
      />
    </div>
  );
}

/**
 * VALIDATION_INCONSISTENCY (D13): reanudar vuelve a producir el mismo error
 * y manda el episodio a Falló, así que "Reanudar" se muestra deshabilitado,
 * con la explicación. Solo queda "Rechazar".
 */
function ValidationInconsistency({ detail }: { detail: EpisodeDetail }) {
  const explanationId = useId();
  const agents = agentsWithoutOfficialArguments(detail);
  return (
    <div className="space-y-3 text-sm">
      <p>
        En el contrainterrogatorio, un agente tenía que responder a un argumento aprobado de su oponente, pero el
        oponente no tiene ninguno.
      </p>
      {agents.length > 0 ? (
        <div>
          <p>
            {agents.length === 1
              ? "Agente sin argumentos aprobados (el otro no tiene a qué responder):"
              : "Agentes sin argumentos aprobados:"}
          </p>
          <ul className="list-disc pl-5">
            {agents.map((agent) => (
              <li key={agent.agentId}>{agent.name}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground">
          No se pudo identificar, a partir del debate, qué agente no tiene argumentos aprobados.
        </p>
      )}
      <p id={explanationId} className="text-muted-foreground">
        Reanudar vuelve a producir el mismo error y el episodio pasa a Falló, así que no se puede reanudar. La única
        opción es rechazarlo.
      </p>
      <Button disabled aria-describedby={explanationId}>
        <Play aria-hidden="true" />
        Reanudar
      </Button>
    </div>
  );
}

/** Motivo que la API todavía no documenta (AC 3.55): el código crudo y solo "Rechazar". */
function UnknownReason({ reason }: { reason: string | null }) {
  return (
    <div className="space-y-2 text-sm">
      {reason === null ? (
        <p>El episodio no tiene un motivo de interrupción registrado.</p>
      ) : (
        <p>
          El episodio se frenó por un motivo que el panel no conoce:{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{reason}</code>.
        </p>
      )}
      <p className="text-muted-foreground">
        Sin saber qué pide ese motivo, el panel no puede reanudarlo. La única opción desde acá es rechazar el episodio.
      </p>
    </div>
  );
}
