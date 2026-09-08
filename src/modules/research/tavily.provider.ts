import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { retry, handleAll, ExponentialBackoff, circuitBreaker, ConsecutiveBreaker, wrap } from "cockatiel";
import type { Env } from "../../shared/config/env.schema";

// Política propia de TavilyProvider (coding-rules.md §4) — no se comparte con
// la política de generateObject de ResearchService, que falla distinto
// (rate limits/timeouts HTTP vs. output mal formado del LLM).
const retryPolicy = retry(handleAll, { maxAttempts: 3, backoff: new ExponentialBackoff() });
const breakerPolicy = circuitBreaker(handleAll, {
  halfOpenAfter: 10_000,
  breaker: new ConsecutiveBreaker(5),
});
const policy = wrap(retryPolicy, breakerPolicy);

export interface TavilySearchResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyApiResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyApiResponse {
  results: TavilyApiResult[];
}

// Único cliente HTTP de Tavily del proyecto (mismo criterio que
// ModelProviderFactory/PrismaService: un solo lugar que sabe hablar con el
// proveedor externo). search_depth: "basic" a propósito — 1 crédito por
// llamada en vez de 2 (advanced), alcanza para el mínimo de 3 fuentes de
// AC 1.2 sin duplicar el costo del free tier (ver tasks.md sección 1).
@Injectable()
export class TavilyProvider {
  constructor(private readonly config: ConfigService<Env, true>) {}

  async search(query: string): Promise<TavilySearchResult[]> {
    return policy.execute(async () => {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.get("TAVILY_API_KEY", { infer: true })}`,
        },
        body: JSON.stringify({
          query,
          search_depth: "basic",
          max_results: 8,
        }),
      });

      if (!response.ok) {
        throw new Error(`Tavily respondió ${response.status}: ${await response.text()}`);
      }

      const data = (await response.json()) as TavilyApiResponse;
      return data.results.map((r) => ({ title: r.title, url: r.url, content: r.content }));
    });
  }
}
