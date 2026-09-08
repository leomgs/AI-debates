import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { generateObject } from "ai";
import { retry, handleAll, ExponentialBackoff, circuitBreaker, ConsecutiveBreaker, wrap } from "cockatiel";
import { Topic, Source } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { ModelProviderFactory } from "../ai/model-provider.factory";
import { TavilyProvider } from "./tavily.provider";
import { InsufficientEvidenceError } from "./research.errors";
import { ResearchOutput, ResearchOutputSchema } from "../../shared/contracts/agents.contracts";

// Política propia de ResearchService (coding-rules.md §4) — la llamada al
// LLM de extracción falla distinto a la búsqueda web de TavilyProvider
// (rate limits/output mal formado vs. rate limits/timeouts HTTP).
const retryPolicy = retry(handleAll, { maxAttempts: 3, backoff: new ExponentialBackoff() });
const breakerPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: 10_000,
  breaker: new ConsecutiveBreaker(5),
});
const policy = wrap(retryPolicy, breakerPolicy);

const MIN_VALID_SOURCES = 3; // AC 1.2 / features.md Feature 1, edge case

function buildExtractionSystemPrompt(): string {
  return [
    "Sos un extractor de hechos para una Evidence Base de investigación.",
    "Tu única función es leer fuentes ya recolectadas y extraer afirmaciones factuales concretas (Facts/Data_Points), citando siempre la fuente exacta de la que salió cada una.",
    "No opines, no completes con conocimiento propio lo que las fuentes no dicen explícitamente, no inventes datos.",
  ].join("\n\n");
}

function buildExtractionPrompt(topic: string, sources: Source[]): string {
  return [
    `Tema de investigación: ${topic}`,
    `Fuentes recolectadas (usá exactamente el id indicado en el campo sourceId de cada fact que extraigas):`,
    sources.map((s) => `- id: ${s.id}\n  título: ${s.title}\n  contenido: ${s.snippet}`).join("\n"),
    "Extraé los hechos relevantes para el tema. Cada fact debe tener un sourceId que matchee exactamente uno de los ids de arriba.",
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
    private readonly modelProviderFactory: ModelProviderFactory
  ) {}

  async createTopic(title: string, context: string): Promise<Topic> {
    return this.prisma.topic.create({ data: { title, context } });
  }

  // research() NO es el research(topic: string) del contrato DebateAgent
  // original (se sacó de ahí — ver agents.contracts.ts) — toma topicId
  // porque ResearchSession.topicId es obligatorio en schema.prisma, y Topic
  // le pertenece a este módulo (architecture.md §6). Pendiente de validar
  // cuando se construya EpisodesModule: quién crea el Topic y en qué paso
  // exacto del pipeline se le pasa el id acá.
  async research(topicId: string): Promise<ResearchOutput> {
    const topic = await this.prisma.topic.findUniqueOrThrow({ where: { id: topicId } });

    const rawResults = await this.tavily.search(topic.title);

    // Dedup por contentHash — Feature 1: "fuentes válidas con hashes de
    // contenido distintos", no simplemente >=3 resultados devueltos.
    const seenHashes = new Set<string>();
    const validSources: Array<{ title: string; url: string; snippet: string; contentHash: string }> = [];
    for (const r of rawResults) {
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
      const result = await generateObject({
        model,
        schema: ResearchOutputSchema,
        system: buildExtractionSystemPrompt(),
        prompt: buildExtractionPrompt(topic.title, researchSession.sources),
      });
      return ResearchOutputSchema.parse(result.object); // dentro del retry — coding-rules.md §3
    });

    await this.prisma.evidenceFact.createMany({
      data: extraction.facts.map((f) => ({ sourceId: f.sourceId, content: f.statement })),
    });

    return extraction;
  }
}
