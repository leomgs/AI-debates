import { Injectable } from "@nestjs/common";
import { generateObject } from "ai";
import { retry, handleWhen, ExponentialBackoff, circuitBreaker, ConsecutiveBreaker, wrap } from "cockatiel";
import { Claim, ModelProvider } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ModelProviderFactory } from "../ai/model-provider.factory";
import { LlmRateLimiterService } from "../ai/llm-rate-limiter.service";
import { DailyQuotaExceededError } from "../ai/ai.errors";
import {
  ClaimExtractionOutputSchema,
  FactCheckOutput,
  FactCheckOutputSchema,
  EditorialReviewOutput,
  EditorialReviewOutputSchema,
  DebateContext,
} from "../../shared/contracts/agents.contracts";
import { DebaterPersona } from "../../shared/personas/agents.personas";

// Política propia de FactCheckModule (coding-rules.md §4) — los tres métodos
// llaman a generateObject (misma clase de integración, igual que
// AgentsModule), así que comparten una sola instancia. handleWhen (no
// handleAll) excluye DailyQuotaExceededError — la tira LlmRateLimiterService
// de forma deliberada (RPD agotado, fail-fast) y reintentarla en segundos no
// la resuelve (decision-log.md 2026-09-08, #8).
const notDailyQuotaExceeded = (err: unknown) => !(err instanceof DailyQuotaExceededError);
const retryPolicy = retry(handleWhen(notDailyQuotaExceeded), { maxAttempts: 3, backoff: new ExponentialBackoff() });
const breakerPolicy = circuitBreaker(handleWhen(notDailyQuotaExceeded), {
  halfOpenAfter: 10_000,
  breaker: new ConsecutiveBreaker(5),
});
const policy = wrap(retryPolicy, breakerPolicy);

function formatEvidence(evidenceBase: DebateContext["evidenceBase"]): string {
  if (evidenceBase.facts.length === 0) return "(sin evidencia disponible)";
  return evidenceBase.facts.map((fact) => `- ${fact.statement} (fuente: ${fact.sourceId})`).join("\n");
}

function buildClaimExtractionSystemPrompt(): string {
  return [
    "Sos un extractor de claims (afirmaciones discretas) de un argumento de debate.",
    "Segmentá el texto en afirmaciones individuales y clasificá cada una en FACTUAL, OPINION, PREDICTION o SUBJECTIVE.",
    "FACTUAL: afirmaciones verificables contra evidencia externa (datos, hechos, cifras concretas).",
    "OPINION / PREDICTION / SUBJECTIVE: juicios de valor, proyecciones a futuro o apreciaciones subjetivas — no requieren evidencia externa para ser válidas.",
  ].join("\n\n");
}

function buildClaimExtractionPrompt(content: string): string {
  return `Argumento a segmentar en claims:\n\n${content}`;
}

function buildFactCheckSystemPrompt(): string {
  return [
    "Sos un fact-checker estricto.",
    "Tu única función es verificar si una afirmación factual puntual es TRUE, FALSE, MISLEADING, UNSUPPORTED o CONTESTED, usando EXCLUSIVAMENTE la evidencia provista — nunca tu conocimiento propio.",
    "Todo tu análisis tiene que estar respaldado citando al menos un sourceId de la evidencia provista (AC 1.2 — trazabilidad obligatoria).",
  ].join("\n\n");
}

function buildFactCheckPrompt(statement: string, evidenceBase: DebateContext["evidenceBase"]): string {
  return [
    `Afirmación a verificar: "${statement}"`,
    `Evidencia disponible:\n${formatEvidence(evidenceBase)}`,
    "Evaluá la afirmación contra ESA evidencia únicamente. Citá los sourceId que respaldan tu análisis.",
  ].join("\n\n");
}

function buildEditorialReviewSystemPrompt(persona: DebaterPersona): string {
  return [
    `Sos un editor que revisa si un texto respeta la personalidad de ${persona.displayName} y las reglas de moderación básicas — no si es cierto o falso, eso no es tu función.`,
    `Reglas que no puede romper bajo ninguna circunstancia: ${persona.editorialRules.forbidden.join("; ")}.`,
    `Reglas que siempre debe cumplir: ${persona.editorialRules.required.join("; ")}.`,
  ].join("\n\n");
}

function buildEditorialReviewPrompt(statement: string): string {
  return `Afirmación a revisar: "${statement}"`;
}

@Injectable()
export class FactCheckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelProviderFactory: ModelProviderFactory,
    private readonly rateLimiter: LlmRateLimiterService
  ) {}

  // Feature 3: segmenta el DRAFT en claims discretos y los clasifica. Persiste
  // cada uno como Claim (Claim.argumentId es obligatorio en schema.prisma —
  // el Argument ya tiene que existir, ver DebateModule.createDraftArgument).
  async extractClaims(argumentId: string, content: string, provider: ModelProvider): Promise<Claim[]> {
    const model = this.modelProviderFactory.resolve(provider);
    const extraction = await policy.execute(async () => {
      await this.rateLimiter.acquire(provider);
      const result = await generateObject({
        model,
        schema: ClaimExtractionOutputSchema,
        system: buildClaimExtractionSystemPrompt(),
        prompt: buildClaimExtractionPrompt(content),
      });
      return ClaimExtractionOutputSchema.parse(result.object); // dentro del retry — coding-rules.md §3
    });

    return Promise.all(
      extraction.claims.map((c) => this.prisma.claim.create({ data: { argumentId, statement: c.statement, type: c.type } }))
    );
  }

  // Ruteo FACTUAL (Feature 3) — persiste el FactCheck ligado al Claim y a
  // las Source citadas (Feature 10 — trazabilidad de auditoría), sin
  // importar el resultado (incluso un FALSE queda auditado).
  async check(claim: Claim, evidenceBase: DebateContext["evidenceBase"], provider: ModelProvider): Promise<FactCheckOutput> {
    const model = this.modelProviderFactory.resolve(provider);
    const output = await policy.execute(async () => {
      await this.rateLimiter.acquire(provider);
      const result = await generateObject({
        model,
        schema: FactCheckOutputSchema,
        system: buildFactCheckSystemPrompt(),
        prompt: buildFactCheckPrompt(claim.statement, evidenceBase),
      });
      return FactCheckOutputSchema.parse(result.object);
    });

    await this.prisma.factCheck.create({
      data: {
        claimId: claim.id,
        veracity: output.veracity,
        analysis: output.analysis,
        sources: { connect: output.sourceIds.map((id) => ({ id })) },
      },
    });

    return output;
  }

  // Ruteo OPINION/PREDICTION/SUBJECTIVE (Feature 3) — no hay tabla propia
  // para esto en schema.prisma, así que no persiste nada: el orquestador
  // reacciona directo al resultado (loop de enmienda si passed=false).
  async editorialReview(claim: Claim, persona: DebaterPersona, provider: ModelProvider): Promise<EditorialReviewOutput> {
    const model = this.modelProviderFactory.resolve(provider);
    return policy.execute(async () => {
      await this.rateLimiter.acquire(provider);
      const result = await generateObject({
        model,
        schema: EditorialReviewOutputSchema,
        system: buildEditorialReviewSystemPrompt(persona),
        prompt: buildEditorialReviewPrompt(claim.statement),
      });
      return EditorialReviewOutputSchema.parse(result.object);
    });
  }
}
