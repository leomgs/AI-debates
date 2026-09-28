import { Injectable } from "@nestjs/common";
import { generateObject } from "ai";
import { retry, handleWhen, ExponentialBackoff, circuitBreaker, ConsecutiveBreaker, wrap } from "cockatiel";
import { Claim, DebateLanguage, ModelProvider } from "@prisma/client";
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
import { buildLanguageInstruction, describeLanguage } from "../../shared/personas/language-instruction";

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

// Spec 004, D7 y AC 4.7: las tres evaluadoras reciben el idioma del episodio.
// El system prompt (en español neutro, D11) dice en qué idioma está el texto
// evaluado y en cuál se escriben los campos libres; la última línea del
// prompt de usuario repite la instrucción en el idioma de destino
// (buildLanguageInstruction), igual que en las llamadas generativas. Los
// campos libres vuelven al debatiente como feedback de enmienda
// (feedback.details): en otro idioma aumentarían el riesgo de que la
// enmienda cambie de idioma.
function withLanguageInstruction(lines: string[], language: DebateLanguage): string {
  return [...lines, buildLanguageInstruction(language)].join("\n\n");
}

function buildClaimExtractionSystemPrompt(language: DebateLanguage): string {
  return [
    "Eres un extractor de claims (afirmaciones discretas) de un argumento de debate.",
    "Segmenta el texto en afirmaciones individuales y clasifica cada una en FACTUAL, OPINION, PREDICTION o SUBJECTIVE.",
    "FACTUAL: afirmaciones verificables contra evidencia externa (datos, hechos, cifras concretas).",
    "OPINION / PREDICTION / SUBJECTIVE: juicios de valor, proyecciones a futuro o apreciaciones subjetivas — no requieren evidencia externa para ser válidas.",
    `Idioma: el argumento está escrito en ${describeLanguage(language)}. Escribe cada statement en ese mismo idioma, sin traducirlo; los valores de type no se traducen.`,
  ].join("\n\n");
}

function buildClaimExtractionPrompt(content: string, language: DebateLanguage): string {
  return withLanguageInstruction([`Argumento a segmentar en claims:\n\n${content}`], language);
}

function buildFactCheckSystemPrompt(language: DebateLanguage): string {
  return [
    "Eres un fact-checker estricto.",
    "Tu única función es verificar si una afirmación factual puntual es TRUE, FALSE, MISLEADING, UNSUPPORTED o CONTESTED, usando EXCLUSIVAMENTE la evidencia provista — nunca tu conocimiento propio.",
    "Todo tu análisis tiene que estar respaldado citando al menos un sourceId de la evidencia provista (AC 1.2 — trazabilidad obligatoria).",
    `Idioma: la afirmación a verificar está escrita en ${describeLanguage(language)}. Escribe el analysis en ese mismo idioma; los valores de veracity y los sourceId no se traducen.`,
  ].join("\n\n");
}

function buildFactCheckPrompt(statement: string, evidenceBase: DebateContext["evidenceBase"], language: DebateLanguage): string {
  return withLanguageInstruction(
    [
      `Afirmación a verificar: "${statement}"`,
      `Evidencia disponible:\n${formatEvidence(evidenceBase)}`,
      "Evalúa la afirmación contra ESA evidencia únicamente. Cita los sourceId que respaldan tu análisis.",
    ],
    language
  );
}

function buildEditorialReviewSystemPrompt(persona: DebaterPersona, language: DebateLanguage): string {
  return [
    `Eres un editor que revisa si un texto respeta la personalidad de ${persona.displayName} y las reglas de moderación básicas — no si es cierto o falso, eso no es tu función.`,
    `Reglas que no puede romper bajo ninguna circunstancia: ${persona.editorialRules.forbidden.join("; ")}.`,
    `Reglas que siempre debe cumplir: ${persona.editorialRules.required.join("; ")}.`,
    "La afirmación a revisar es UN claim extraído de un argumento más largo — puede depender de datos o razonamiento que aparecen en otra parte de ese argumento. Evalúa la afirmación en el contexto del argumento completo (aparece abajo), no de forma aislada. Por ejemplo, una afirmación de peso que se apoya en un dato citado en una oración cercana del mismo argumento NO rompe una regla de 'no hacer afirmaciones sin respaldo', aunque el dato no esté repetido en la afirmación misma.",
    // Las reglas editoriales siguen en español (D11) aunque el texto esté en
    // otro idioma (spec 004, edge case "Reglas editoriales en español
    // evaluando texto en otro idioma"): se aclara que se aplican al
    // contenido, para no sumar rechazos espurios por el idioma.
    `Idioma: la afirmación y el argumento están escritos en ${describeLanguage(language)}. Las reglas de arriba están en español: aplícalas al contenido del texto, no al idioma en que está escrito. Si passed es false, escribe violatedRule y reason en ${describeLanguage(language)}.`,
  ].join("\n\n");
}

// argumentContent: bug real encontrado corriendo scripts/smoke-test-episode.ts
// contra APIs reales (decision-log.md 2026-09-08 #11/#12) — evaluar el claim
// sin el argumento completo alrededor hacía que el editor rechazara
// afirmaciones bien respaldadas (el respaldo vivía en una oración vecina, no
// en el claim mismo, ya que extractClaims segmenta el argumento en
// afirmaciones discretas). Esto disparaba el loop de enmienda repetidamente
// sin necesidad, agotando el presupuesto de LLM del episodio.
function buildEditorialReviewPrompt(statement: string, argumentContent: string, language: DebateLanguage): string {
  return withLanguageInstruction(
    [`Afirmación a revisar: "${statement}"`, `Argumento completo del que salió esta afirmación:\n"${argumentContent}"`],
    language
  );
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
  async extractClaims(argumentId: string, content: string, provider: ModelProvider, language: DebateLanguage): Promise<Claim[]> {
    const model = this.modelProviderFactory.resolve(provider);
    const extraction = await policy.execute(async () => {
      await this.rateLimiter.acquire(provider);
      const result = await generateObject({
        model,
        schema: ClaimExtractionOutputSchema,
        system: buildClaimExtractionSystemPrompt(language),
        prompt: buildClaimExtractionPrompt(content, language),
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
  async check(
    claim: Claim,
    evidenceBase: DebateContext["evidenceBase"],
    provider: ModelProvider,
    language: DebateLanguage
  ): Promise<FactCheckOutput> {
    const model = this.modelProviderFactory.resolve(provider);
    const output = await policy.execute(async () => {
      await this.rateLimiter.acquire(provider);
      const result = await generateObject({
        model,
        schema: FactCheckOutputSchema,
        system: buildFactCheckSystemPrompt(language),
        prompt: buildFactCheckPrompt(claim.statement, evidenceBase, language),
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
  async editorialReview(
    claim: Claim,
    persona: DebaterPersona,
    provider: ModelProvider,
    argumentContent: string,
    language: DebateLanguage
  ): Promise<EditorialReviewOutput> {
    const model = this.modelProviderFactory.resolve(provider);
    return policy.execute(async () => {
      await this.rateLimiter.acquire(provider);
      const result = await generateObject({
        model,
        schema: EditorialReviewOutputSchema,
        system: buildEditorialReviewSystemPrompt(persona, language),
        prompt: buildEditorialReviewPrompt(claim.statement, argumentContent, language),
      });
      return EditorialReviewOutputSchema.parse(result.object);
    });
  }
}
