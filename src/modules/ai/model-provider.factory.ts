import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import { ModelProvider } from "@prisma/client";
import type { Env } from "../config/env.schema";

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
        return createGoogleGenerativeAI({
          apiKey: this.config.get("GOOGLE_API_KEY", { infer: true }),
        })("gemini-2.0-flash");

      // ANTHROPIC y XAI ya existen en el enum (schema.prisma los deja
      // extensibles a propósito) pero todavía no están conectados acá.
      // Habilitarlos: instalar @ai-sdk/anthropic o @ai-sdk/xai, agregar
      // la env var correspondiente a env.schema.ts, y sumar el case.
      case "ANTHROPIC":
      case "XAI":
        throw new Error(
          `ModelProvider "${provider}" está definido en el schema pero todavía no tiene un cliente configurado en ModelProviderFactory.`
        );

      default: {
        const _exhaustive: never = provider;
        throw new Error(`ModelProvider no reconocido: ${provider}`);
      }
    }
  }
}
