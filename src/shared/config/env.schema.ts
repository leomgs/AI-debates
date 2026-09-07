import { z } from "zod";

// Única fuente de verdad de qué env vars existen. Nadie lee process.env.X
// directo en ningún otro archivo — todo pasa por ConfigService, que valida
// contra esto al arrancar (ver AppModule).
export const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1), // sqlite: "file:./dev.db"

  OPENAI_API_KEY: z.string().min(1),
  GOOGLE_API_KEY: z.string().min(1),
  // ANTHROPIC_API_KEY / XAI_API_KEY: agregar acá recién cuando se habiliten
  // esos providers en ModelProviderFactory — no antes.

  GOOGLE_TTS_API_KEY: z.string().optional(), // según el wrapper de google-tts-api que termines usando

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
