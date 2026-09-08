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

  GOOGLE_TTS_API_KEY: z.string().optional(), // según el wrapper de google-tts-api que termines usando

  // Requerida: proveedor de búsqueda web decidido para ResearchModule
  // (free tier: 1000 créditos/mes sin tarjeta — ver tasks.md sección 1).
  // A diferencia de OPENAI/ANTHROPIC/XAI, Research es P0 y no tiene sentido
  // arrancar el proceso sin poder ejecutar una research real.
  TAVILY_API_KEY: z.string().min(1),

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
