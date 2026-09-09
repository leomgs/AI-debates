import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { BudgetExceededError } from "./episodes.errors";

// AC 2.1 (features.md Feature 2): "antes de cada llamada a un LLM o
// proveedor de TTS, el orquestador verificará que el acumulado en
// EpisodeUsage no supere el límite configurado". Centralizado acá como
// wrapper — así ningún punto del orquestador puede llamar a un servicio de
// dominio sin pasar por el chequeo (a diferencia de un chequeo manual
// repetido antes de cada call site, fácil de olvidar en alguno).
@Injectable()
export class EpisodeBudgetService {
  constructor(private readonly prisma: PrismaService) {}

  async withLlmCall<T>(episodeId: string, fn: () => Promise<T>): Promise<T> {
    return this.withBudget(episodeId, "llmCalls", fn);
  }

  async withSearchRequest<T>(episodeId: string, fn: () => Promise<T>): Promise<T> {
    return this.withBudget(episodeId, "searchRequests", fn);
  }

  // AC 2.1 no distingue entre LLM/búsqueda/TTS — TtsService.synthesizeSegment
  // pasa por acá igual que cualquier otra llamada externa (etapa 2 de TTS,
  // tasks.md sección 5).
  async withTtsCall<T>(episodeId: string, fn: () => Promise<T>): Promise<T> {
    return this.withBudget(episodeId, "ttsRequests", fn);
  }

  // Bug real encontrado corriendo scripts/smoke-test-episode.ts contra APIs
  // reales (2026-09-08, ver decision-log.md): processDraft verifica los
  // claims de un argumento en paralelo (Promise.all sobre withLlmCall, D-7
  // del plan de EpisodesModule) — el "leer contador -> chequear -> ejecutar
  // -> incrementar" original tenía una condición de carrera clásica: N
  // llamadas concurrentes leían el mismo contador desactualizado, todas
  // pasaban el chequeo, y las N incrementaban después. EpisodeUsage.llmCalls
  // llegó a 38 con maxLlmCalls: 25. Se reemplaza por un UPDATE atómico a
  // nivel de DB (WHERE metric < limit) — ni siquiera necesita un mutex en
  // memoria (a diferencia de LlmRateLimiterService, que sí lo necesita
  // porque su chequeo de ventana deslizante no se puede expresar en un único
  // UPDATE condicional).
  private async withBudget<T>(
    episodeId: string,
    metric: "llmCalls" | "searchRequests" | "ttsRequests",
    fn: () => Promise<T>
  ): Promise<T> {
    const episode = await this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId } });
    const limit =
      metric === "llmCalls" ? episode.maxLlmCalls : metric === "searchRequests" ? episode.maxSearchQueries : episode.maxTtsSegments;

    const claimed = await this.prisma.episodeUsage.updateMany({
      where: { episodeId, [metric]: { lt: limit } },
      data: { [metric]: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new BudgetExceededError("USAGE_LIMIT_EXCEEDED", metric, limit);
    }

    // El incremento ya se aplicó (atómico, arriba) para que el chequeo en sí
    // no tenga carrera — si fn() falla, hay que revertirlo a mano acá para
    // preservar la semántica original: solo las llamadas exitosas consumen
    // presupuesto real.
    try {
      return await fn();
    } catch (err) {
      await this.prisma.episodeUsage.update({
        where: { episodeId },
        data: { [metric]: { decrement: 1 } },
      });
      throw err;
    }
  }
}
