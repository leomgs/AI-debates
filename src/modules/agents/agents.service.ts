import { Injectable } from '@nestjs/common';
import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import {
  retry,
  handleAll,
  ExponentialBackoff,
  circuitBreaker,
  ConsecutiveBreaker,
  wrap,
} from 'cockatiel';
import { ModelProvider } from '@prisma/client';
import { ModelProviderFactory } from '../ai/model-provider.factory';
import {
  ArgumentDraft,
  ArgumentDraftSchema,
  CrossExaminationDraft,
  CrossExaminationDraftSchema,
  AmendmentFeedback,
  DebateContext,
  DebateAgent,
  RoundType,
  VerdictOutput,
  VerdictOutputSchema,
} from '../../shared/contracts/agents.contracts';
import {
  DebaterPersona,
  JUDGE,
  buildDebaterSystemPrompt,
  buildJudgeSystemPrompt,
} from '../../shared/personas/agents.personas';

// Política propia de AgentsModule (coding-rules.md §4) — no se comparte con
// research/tts, que fallan distinto.
const retryPolicy = retry(handleAll, {
  maxAttempts: 3,
  backoff: new ExponentialBackoff(),
});
const breakerPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: 10_000,
  breaker: new ConsecutiveBreaker(5),
});
const policy = wrap(retryPolicy, breakerPolicy);

function formatEvidence(evidenceBase: DebateContext['evidenceBase']): string {
  if (evidenceBase.facts.length === 0) return '(sin evidencia disponible)';
  return evidenceBase.facts
    .map((fact) => `- ${fact.statement} (fuente: ${fact.sourceId})`)
    .join('\n');
}

function formatOfficialArguments(
  officialArguments: DebateContext['officialArguments'],
): string {
  if (officialArguments.length === 0)
    return '(ninguno todavía — sos el primero en hablar)';
  return officialArguments
    .map((arg) => `- [${arg.roundType}] agente ${arg.agentId}: ${arg.content}`)
    .join('\n');
}

function buildArguePrompt(context: DebateContext): string {
  return [
    `Tema del debate: ${context.topic}`,
    `Evidencia disponible (Evidence Base):\n${formatEvidence(context.evidenceBase)}`,
    `Argumentos oficiales presentados hasta ahora en el debate:\n${formatOfficialArguments(context.officialArguments)}`,
    `Generá tu argumento para esta intervención.`,
  ].join('\n\n');
}

function buildRespondPrompt(
  context: DebateContext,
  target: DebateContext['officialArguments'][number],
): string {
  return [
    `Tema del debate: ${context.topic}`,
    `Evidencia disponible (Evidence Base):\n${formatEvidence(context.evidenceBase)}`,
    `Argumentos oficiales presentados hasta ahora en el debate:\n${formatOfficialArguments(context.officialArguments)}`,
    `Te toca hacer cross-examination del siguiente argumento puntual (agente ${target.agentId}, id: ${target.id}):\n"${target.content}"`,
    `Generá tu respuesta dirigida específicamente a ese argumento. En el campo respondsToId devolvé exactamente este id: ${target.id}.`,
  ].join('\n\n');
}

function buildAmendPrompt(
  context: DebateContext,
  original: ArgumentDraft | CrossExaminationDraft,
  feedback: AmendmentFeedback,
): string {
  return [
    `Tema del debate: ${context.topic}`,
    `Evidencia disponible (Evidence Base):\n${formatEvidence(context.evidenceBase)}`,
    `Tu borrador anterior fue rechazado:\n"${original.content}"`,
    `Motivo del rechazo: ${feedback.reason}`,
    feedback.failedClaim
      ? `Afirmación que falló la verificación: "${feedback.failedClaim}"`
      : null,
    `Detalle: ${feedback.details}`,
    `Generá una nueva versión que corrija este problema, manteniendo tu postura y estilo.`,
    'respondsToId' in original
      ? `Recordá devolver el mismo respondsToId: ${original.respondsToId}`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n\n');
}

function buildJudgePrompt(context: DebateContext): string {
  return [
    `Tema debatido: ${context.topic}`,
    `Transcripción completa del debate (argumentos oficiales, en orden):\n${formatOfficialArguments(context.officialArguments)}`,
    `Emití tu veredicto. Si corresponde declarar un ganador, winnerAgentId debe ser el id de uno de los agentes que participó del debate; si no hay un ganador claro, winnerAgentId puede ser null.`,
  ].join('\n\n');
}

// DebateAgent ya no incluye research() (ver nota en agents.contracts.ts) —
// research le pertenece a ResearchModule (dueño de Topic/Source/EvidenceFact,
// architecture.md §6), no a AgentsModule.
export type DebaterAgent = DebateAgent;

// Una instancia por (persona, provider) — no por turno. roundType ahora es
// parámetro explícito de argue()/amend() (contrato en agents.contracts.ts),
// así que la instancia no necesita cerrar sobre él: el orquestador crea el
// agente una vez por EpisodeParticipant y lo reusa en todos sus turnos
// durante el loop de rondas (architecture.md §7.2).
class DebaterAgentImpl implements DebaterAgent {
  constructor(
    private readonly persona: DebaterPersona,
    private readonly model: LanguageModel,
  ) {}

  async argue(
    context: DebateContext,
    roundType: 'OPENING' | 'REBUTTAL',
  ): Promise<ArgumentDraft> {
    const system = buildDebaterSystemPrompt(this.persona, roundType);
    return policy.execute(async () => {
      const result = await generateObject({
        model: this.model,
        schema: ArgumentDraftSchema,
        system,
        prompt: buildArguePrompt(context),
      });
      return ArgumentDraftSchema.parse(result.object); // dentro del retry — coding-rules.md §3
    });
  }

  async respond(
    context: DebateContext,
    target: DebateContext['officialArguments'][number],
  ): Promise<CrossExaminationDraft> {
    const system = buildDebaterSystemPrompt(this.persona, 'CROSS_EXAMINATION');
    return policy.execute(async () => {
      const result = await generateObject({
        model: this.model,
        schema: CrossExaminationDraftSchema,
        system,
        prompt: buildRespondPrompt(context, target),
      });
      return CrossExaminationDraftSchema.parse(result.object);
    });
  }

  async amend(
    context: DebateContext,
    original: ArgumentDraft | CrossExaminationDraft,
    feedback: AmendmentFeedback,
    roundType: RoundType,
  ): Promise<ArgumentDraft | CrossExaminationDraft> {
    const system = buildDebaterSystemPrompt(this.persona, roundType);
    const schema =
      roundType === 'CROSS_EXAMINATION'
        ? CrossExaminationDraftSchema
        : ArgumentDraftSchema;
    return policy.execute(async () => {
      const result = await generateObject({
        model: this.model,
        schema,
        system,
        prompt: buildAmendPrompt(context, original, feedback),
      });
      return schema.parse(result.object);
    });
  }
}

@Injectable()
export class AgentsService {
  constructor(private readonly modelProviderFactory: ModelProviderFactory) {}

  // Factory: EpisodesModule (o quien orqueste el debate) la llama una vez por
  // EpisodeParticipant al arrancar el episodio, y reusa la misma instancia en
  // todos los turnos de ese agente (roundType viaja por parámetro en cada
  // llamada, no queda fijo en la instancia).
  createDebateAgent(persona: DebaterPersona, provider: ModelProvider): DebaterAgent {
    const model = this.modelProviderFactory.resolve(provider);
    return new DebaterAgentImpl(persona, model);
  }

  // Judge no es un DebaterPersona ni sigue el ciclo argue/respond/amend — es
  // el veredicto final de architecture.md §7.4, un único llamado por episodio.
  async judge(
    context: DebateContext,
    provider: ModelProvider,
  ): Promise<VerdictOutput> {
    const model = this.modelProviderFactory.resolve(provider);
    const system = buildJudgeSystemPrompt(JUDGE);
    return policy.execute(async () => {
      const result = await generateObject({
        model,
        schema: VerdictOutputSchema,
        system,
        prompt: buildJudgePrompt(context),
      });
      return VerdictOutputSchema.parse(result.object);
    });
  }
}
