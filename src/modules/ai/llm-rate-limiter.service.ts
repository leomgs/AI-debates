import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModelProvider } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import type { Env } from "../../shared/config/env.schema";
import { DailyQuotaExceededError, RateLimitWaitExceededError } from "./ai.errors";

const RPM_WINDOW_MS = 60_000;
const RPD_WINDOW_MS = 24 * 60 * 60 * 1000;
const PRUNE_THRESHOLD_MS = 48 * 60 * 60 * 1000; // higiene, no crítico al volumen actual
const MAX_WAIT_MS = 90_000; // cap defensivo — decision-log.md 2026-09-08 #8

interface ProviderRateLimit {
  rpm: number;
  rpd: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Único gate PROACTIVO de llamadas a LLM del proyecto, indexado por
// ModelProvider (la cuota de free tier es por API key, no por módulo
// llamante) — a diferencia de las policies de Cockatiel de cada servicio,
// que son reactivas (reintentan después de un 429) y siguen sin cambios.
// acquire() se llama DENTRO del bloque que cada servicio ya reintenta con
// Cockatiel, justo antes de generateObject (decision-log.md 2026-09-08, #8).
@Injectable()
export class LlmRateLimiterService {
  // null = sin límite proactivo configurado todavía (OPENAI/ANTHROPIC/XAI no
  // tienen uso real hoy, ver decisión de 2026-09-07 sobre qué providers son
  // obligatorios) — acquire() se vuelve no-op para esos providers.
  private readonly limits: Record<ModelProvider, ProviderRateLimit | null>;

  // Mutex en memoria por provider — serializa "contar -> decidir ->
  // insertar" dentro de acquireLocked() para evitar una condición de carrera
  // TOCTOU entre llamadas concurrentes del mismo proceso. No se resuelve con
  // una transacción SQLite a propósito: el entorno es single-proceso
  // (confirmado), resolver concurrencia distribuida sería sobre-ingeniería.
  private readonly locks = new Map<ModelProvider, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Env, true>
  ) {
    this.limits = {
      GOOGLE: {
        rpm: config.get("GOOGLE_RPM_LIMIT", { infer: true }),
        rpd: config.get("GOOGLE_RPD_LIMIT", { infer: true }),
      },
      OPENAI: null,
      ANTHROPIC: null,
      XAI: null,
    };
  }

  async acquire(provider: ModelProvider): Promise<void> {
    const limit = this.limits[provider];

    if (!limit) {
      // Se loguea igual por consistencia/observabilidad, sin chequear cupo.
      await this.prisma.llmRequestLog.create({ data: { provider } });
      return;
    }

    // `run` corre después de que el lock anterior de este provider termine
    // (éxito o falla — un fallo previo no debe trabar la cola para siempre).
    // El próximo `tail` se guarda como una versión que siempre resuelve, para
    // que un rechazo de esta llamada no envenene a los que esperan detrás;
    // esta llamada en particular sí propaga su resultado real vía `return run`.
    const tail = this.locks.get(provider) ?? Promise.resolve();
    const run = tail.then(
      () => this.acquireLocked(provider, limit),
      () => this.acquireLocked(provider, limit)
    );
    this.locks.set(
      provider,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  }

  private async acquireLocked(provider: ModelProvider, limit: ProviderRateLimit): Promise<void> {
    const now = Date.now();

    const rpdCount = await this.prisma.llmRequestLog.count({
      where: { provider, requestedAt: { gt: new Date(now - RPD_WINDOW_MS) } },
    });
    if (rpdCount >= limit.rpd) {
      throw new DailyQuotaExceededError(provider, limit.rpd);
    }

    const rpmRequests = await this.prisma.llmRequestLog.findMany({
      where: { provider, requestedAt: { gt: new Date(now - RPM_WINDOW_MS) } },
      orderBy: { requestedAt: "asc" },
      select: { requestedAt: true },
    });
    if (rpmRequests.length >= limit.rpm) {
      const waitMs = rpmRequests[0].requestedAt.getTime() + RPM_WINDOW_MS - now;
      if (waitMs > MAX_WAIT_MS) {
        throw new RateLimitWaitExceededError(provider, waitMs, MAX_WAIT_MS);
      }
      if (waitMs > 0) {
        await sleep(waitMs);
      }
    }

    await this.prisma.llmRequestLog.create({ data: { provider } });
    await this.prune(provider);
  }

  private async prune(provider: ModelProvider): Promise<void> {
    await this.prisma.llmRequestLog.deleteMany({
      where: { provider, requestedAt: { lt: new Date(Date.now() - PRUNE_THRESHOLD_MS) } },
    });
  }
}
