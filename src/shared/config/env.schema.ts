import { z } from "zod";

// Única fuente de verdad de qué env vars existen. Nadie lee process.env.X
// directo en ningún otro archivo — todo pasa por ConfigService, que valida
// contra esto al arrancar (ver AppModule).
export const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1), // sqlite: "file:./dev.db"

  // Única requerida: es la única con la que hay acceso gratuito hoy.
  // Las demás quedan opcionales hasta contratar una suscripción adecuada —
  // ModelProviderFactory tira error recién si algo intenta resolver un
  // provider cuya key falta, no al arrancar el proceso.
  GOOGLE_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  XAI_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),

  GOOGLE_TTS_API_KEY: z.string().optional(), // según el wrapper de google-tts-api que termines usando

  // Requerida: proveedor de búsqueda web decidido para ResearchModule
  // (free tier: 1000 créditos/mes sin tarjeta — ver tasks.md sección 1).
  // A diferencia de OPENAI/ANTHROPIC/XAI, Research es P0 y no tiene sentido
  // arrancar el proceso sin poder ejecutar una research real.
  TAVILY_API_KEY: z.string().min(1),

  // Límites de free tier de Google para LlmRateLimiterService (decision-log.md
  // 2026-09-08, #8) — opcionales con default al valor vigente hoy. Ya
  // cambiaron una vez en la historia del proyecto (ver ModelProviderFactory),
  // así que conviene poder ajustarlos sin recompilar.
  GOOGLE_RPM_LIMIT: z.coerce.number().default(15),
  GOOGLE_RPD_LIMIT: z.coerce.number().default(500),

  // Límites reales del free tier de OpenRouter (validado 2026-09-08, ver
  // decision-log.md): 20 RPM fijo; RPD depende de si la cuenta compró
  // créditos alguna vez (50/día sin créditos, 1000/día si compró $10+) — se
  // asume el caso conservador (sin créditos) como default.
  OPENROUTER_RPM_LIMIT: z.coerce.number().default(20),
  OPENROUTER_RPD_LIMIT: z.coerce.number().default(50),

  PORT: z.coerce.number().default(3000),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n${result.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`
    );
  }
  return result.data;
}
