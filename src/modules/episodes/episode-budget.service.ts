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

  private async withBudget<T>(
    episodeId: string,
    metric: "llmCalls" | "searchRequests",
    fn: () => Promise<T>
  ): Promise<T> {
    const episode = await this.prisma.episode.findUniqueOrThrow({ where: { id: episodeId } });
    const usage = await this.prisma.episodeUsage.findUniqueOrThrow({ where: { episodeId } });

    const limit = metric === "llmCalls" ? episode.maxLlmCalls : episode.maxSearchQueries;
    if (usage[metric] >= limit) {
      throw new BudgetExceededError("USAGE_LIMIT_EXCEEDED", metric, limit);
    }

    // Si fn() lanza (incluida DailyQuotaExceededError del rate limiter, o
    // cualquier excepción de dominio), el contador NO se incrementa — el
    // error se deja propagar tal cual, no se captura acá. Solo un éxito real
    // consume presupuesto.
    const result = await fn();

    await this.prisma.episodeUsage.update({
      where: { episodeId },
      data: { [metric]: { increment: 1 } },
    });

    return result;
  }
}
