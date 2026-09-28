import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { generateObject } from "ai";
import { retry, handleWhen, ExponentialBackoff, circuitBreaker, ConsecutiveBreaker, wrap } from "cockatiel";
import { DebateLanguage, Topic, Source } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ModelProviderFactory } from "../ai/model-provider.factory";
import { LlmRateLimiterService } from "../ai/llm-rate-limiter.service";
import { DailyQuotaExceededError } from "../ai/ai.errors";
import { TavilyProvider } from "./tavily.provider";
import { InsufficientEvidenceError } from "./research.errors";
import { ResearchOutput, ResearchOutputSchema } from "../../shared/contracts/agents.contracts";
import { buildLanguageInstruction, describeLanguage } from "../../shared/personas/language-instruction";

// Política propia de ResearchService (coding-rules.md §4) — la llamada al
// LLM de extracción falla distinto a la búsqueda web de TavilyProvider
// (rate limits/output mal formado vs. rate limits/timeouts HTTP). handleWhen
// (no handleAll) excluye DailyQuotaExceededError — la tira
// LlmRateLimiterService de forma deliberada (RPD agotado, fail-fast) y
// reintentarla en segundos no la resuelve (decision-log.md 2026-09-08, #8).
const notDailyQuotaExceeded = (err: unknown) => !(err instanceof DailyQuotaExceededError);
const retryPolicy = retry(handleWhen(notDailyQuotaExceeded), { maxAttempts: 3, backoff: new ExponentialBackoff() });
const breakerPolicy = circuitBreaker(handleWhen(notDailyQuotaExceeded), {
  halfOpenAfter: 10_000,
  breaker: new ConsecutiveBreaker(5),
});
const policy = wrap(retryPolicy, breakerPolicy);

const MIN_VALID_SOURCES = 3; // AC 1.2 / features.md Feature 1, edge case

// Spec 004, D9 (AC 4.7, 4.13): la búsqueda no se restringe por idioma, así
// que las fuentes pueden venir en cualquiera; los hechos se redactan en el
// idioma del debate, para que debatientes y fact-checker no trabajen con
// evidencia mezclada. El system prompt lo dice en español (D11) y la última
// línea del prompt de usuario repite la instrucción en el idioma de destino.
function buildExtractionSystemPrompt(language: DebateLanguage): string {
  return [
    "Eres un extractor de hechos para una Evidence Base de investigación.",
    "Tu única función es leer fuentes ya recolectadas y extraer afirmaciones factuales concretas (Facts/Data_Points), citando siempre la fuente exacta de la que salió cada una.",
    "No opines, no completes con conocimiento propio lo que las fuentes no dicen explícitamente, no inventes datos.",
    `Idioma: las fuentes pueden estar en cualquier idioma. Redacta cada hecho (statement) en ${describeLanguage(language)}, sin cambiar lo que dice la fuente; los sourceId no se traducen.`,
  ].join("\n\n");
}

function buildExtractionPrompt(topic: string, sources: Source[], language: DebateLanguage): string {
  return [
    `Tema de investigación: ${topic}`,
    `Fuentes recolectadas (usa exactamente el id indicado en el campo sourceId de cada fact que extraigas):`,
    sources.map((s) => `- id: ${s.id}\n  título: ${s.title}\n  contenido: ${s.snippet}`).join("\n"),
    "Extrae los hechos relevantes para el tema. Cada fact debe tener un sourceId que coincida exactamente con uno de los ids de arriba.",
    buildLanguageInstruction(language),
  ].join("\n\n");
}

// Como ResearchModule no tiene (todavía) un mecanismo para elegir
// ModelProvider por research —a diferencia de AgentsModule, donde lo define
// EpisodeParticipant— se usa GOOGLE a propósito: es el único provider
// requerido/garantizado por env.schema.ts (ver decisión de usuario
// 2026-09-07 en tasks.md). Revisar si EpisodesModule termina necesitando
// elegirlo por episodio.
const EXTRACTION_PROVIDER = "GOOGLE" as const;

@Injectable()
export class ResearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tavily: TavilyProvider,
    private readonly modelProviderFactory: ModelProviderFactory,
    private readonly rateLimiter: LlmRateLimiterService
  ) {}

  async createTopic(title: string, context: string): Promise<Topic> {
    return this.prisma.topic.create({ data: { title, context } });
  }

  // research() NO es el research(topic: string) del contrato DebateAgent
  // original (se sacó de ahí — ver agents.contracts.ts) — toma topicId
  // porque ResearchSession.topicId es obligatorio en schema.prisma, y Topic
  // le pertenece a este módulo (architecture.md §6). Resuelto: EpisodesModule
  // crea el Topic en EpisodesService.createEpisode(), antes de llamar acá.
  //
  // language (spec 004, regla de flujo del idioma): el idioma del episodio
  // llega por parámetro, porque Episode no le pertenece a este módulo. Solo
  // cambia el idioma en que se redactan los hechos; la búsqueda en Tavily
  // sigue sin restricción de idioma (D9).
  //
  // manualSources (opcional, aditivo/retrocompatible): usado por
  // EpisodesModule al reanudar un episodio en REQUIRES_HUMAN_REVIEW con
  // reason INSUFFICIENT_EVIDENCE (api-contract.md §3, acción `resume`) — el
  // curador inyecta fuentes manuales para superar el mínimo. research() tira
  // la excepción ANTES de persistir nada, así que no hay fila donde
  // "agregarlas" después: hace falta volver a correr research() completo
  // incluyéndolas en el pool desde el arranque.
  async research(
    topicId: string,
    language: DebateLanguage,
    manualSources?: Array<{ url: string; title: string; snippet: string }>
  ): Promise<ResearchOutput> {
    const topic = await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });

    const rawResults = await this.tavily.search(topic.title);
    // Mismo shape {title, url, content} que TavilySearchResult — las fuentes
    // manuales entran al mismo pool y pasan por el mismo dedup/hash de abajo,
    // sin lógica separada.
    const manualResults = (manualSources ?? []).map((s) => ({ title: s.title, url: s.url, content: s.snippet }));

    // Dedup por contentHash — Feature 1: "fuentes válidas con hashes de
    // contenido distintos", no simplemente >=3 resultados devueltos.
    const seenHashes = new Set<string>();
    const validSources: Array<{ title: string; url: string; snippet: string; contentHash: string }> = [];
    for (const r of [...rawResults, ...manualResults]) {
      const contentHash = createHash("sha256").update(r.content).digest("hex");
      if (seenHashes.has(contentHash)) continue;
      seenHashes.add(contentHash);
      validSources.push({ title: r.title, url: r.url, snippet: r.content, contentHash });
    }

    if (validSources.length < MIN_VALID_SOURCES) {
      throw new InsufficientEvidenceError(validSources.length);
    }

    const researchSession = await this.prisma.researchSession.create({
      data: {
        topicId,
        rawOutput: JSON.stringify(rawResults),
        sources: { create: validSources },
      },
      include: { sources: true },
    });

    const model = this.modelProviderFactory.resolve(EXTRACTION_PROVIDER);
    const extraction = await policy.execute(async () => {
      await this.rateLimiter.acquire(EXTRACTION_PROVIDER);
      const result = await generateObject({
        model,
        schema: ResearchOutputSchema,
        system: buildExtractionSystemPrompt(language),
        prompt: buildExtractionPrompt(topic.title, researchSession.sources, language),
      });
      return ResearchOutputSchema.parse(result.object); // dentro del retry — coding-rules.md §3
    });

    await this.prisma.evidenceFact.createMany({
      data: extraction.facts.map((f) => ({ sourceId: f.sourceId, content: f.statement })),
    });

    return extraction;
  }
}
