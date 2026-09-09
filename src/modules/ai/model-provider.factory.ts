import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { ModelProvider } from "@prisma/client";
import type { Env } from "../../shared/config/env.schema";

// Único lugar del proyecto que mapea ModelProvider (schema.prisma) → cliente
// real del AI SDK. AgentsModule (debatientes + Judge) es el consumidor
// principal, pero cualquier módulo que necesite invocar un LLM pasa por acá
// en vez de instanciar el cliente de un provider directo.
@Injectable()
export class ModelProviderFactory {
  constructor(private readonly config: ConfigService<Env, true>) {}

  resolve(provider: ModelProvider): LanguageModel {
    switch (provider) {
      case "OPENAI":
        return createOpenAI({
          apiKey: this.config.get("OPENAI_API_KEY", { infer: true }),
        })("gpt-4.1");

      case "GOOGLE":
        // gemini-2.0-flash y gemini-2.5-flash fueron dados de baja para
        // cuentas nuevas (404 "no longer available[...]for new users") —
        // detectado corriendo scripts/smoke-test-argument.ts contra la API
        // real (2026-09-08). gemini-3.6-flash (el reemplazo que indica el
        // propio error) funcionaba, pero con cuota free-tier muy ajustada:
        // según el dashboard de rate limits de AI Studio, TODOS los "Flash"
        // normales (cualquier generación: 3, 3.5, 3.6, 3.7, 3.8) están
        // topeados igual en este free tier — 5 RPM / 20 RPD. Las variantes
        // "Flash Lite" tienen 3x más RPM y 25x más RPD (15 RPM / 500 RPD) —
        // se usa gemini-3.5-flash-lite (la Lite más reciente disponible) a
        // cambio de algo menos de calidad/razonamiento, aceptable para este
        // caso de uso (single-user, local).
        return createGoogleGenerativeAI({
          apiKey: this.config.get("GOOGLE_API_KEY", { infer: true }),
        })("gemini-3.5-flash-lite");

      // ANTHROPIC_API_KEY/XAI_API_KEY son opcionales en env.schema.ts (no
      // hay suscripción paga contratada todavía) — si falta la key, el SDK
      // tira su propio error recién acá, al intentar resolver el modelo.
      case "ANTHROPIC":
        return createAnthropic({
          apiKey: this.config.get("ANTHROPIC_API_KEY", { infer: true }),
        })("claude-sonnet-5");

      case "XAI":
        return createXai({
          apiKey: this.config.get("XAI_API_KEY", { infer: true }),
        })("grok-4");

      case "OPENROUTER": {
        // Validado a mano contra la API real (2026-09-08, ver decision-log.md)
        // — de 5 modelos :free que declaran soporte de structured_outputs en
        // OpenRouter, estos 2 lo cumplen de verdad con generateObject. Se
        // sortea entre ambos en cada resolve() (no una vez por proceso) para
        // que "usar los dos modelos" sea real y no solo el primero que
        // aparezca en el código. Los dos comparten la MISMA cuenta/key, así
        // que comparten un único cupo real de RPM/RPD — por eso es un solo
        // ModelProvider.OPENROUTER en vez de dos valores de enum separados:
        // LlmRateLimiterService trackea el cupo por ModelProvider, y dos
        // valores para la misma key hubiera subestimado el uso real.
        const OPENROUTER_MODELS = ["nvidia/nemotron-3-super-120b-a12b:free", "liquid/lfm-2.5-2.6b:free"] as const;
        const modelId = OPENROUTER_MODELS[Math.floor(Math.random() * OPENROUTER_MODELS.length)];
        return createOpenRouter({
          apiKey: this.config.get("OPENROUTER_API_KEY", { infer: true }),
        })(modelId);
      }

      default: {
        const _exhaustive: never = provider;
        throw new Error(`ModelProvider no reconocido: ${provider}`);
      }
    }
  }
}
