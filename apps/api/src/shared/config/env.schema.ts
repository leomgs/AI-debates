import { z } from "zod";
import { isValidPasswordHash } from "../crypto/scrypt-password";

// Default de desarrollo de AUDIO_SIGNING_SECRET. Exportado para que el
// superRefine de abajo lo compare: en producción no se acepta (ADR 0001
// punto 5 — /audio-files queda fuera del SessionGuard y su única protección
// es esta firma).
export const DEFAULT_AUDIO_SIGNING_SECRET = "dev-audio-signing-secret-change-me";

// Única fuente de verdad de qué env vars existen. Nadie lee process.env.X
// directo en ningún otro archivo — todo pasa por ConfigService, que valida
// contra esto al arrancar (ver AppModule).
export const EnvSchema = z
  .object({
    // "production" activa las reglas de despliegue: cookie de sesión Secure,
    // Swagger (/docs) sin montar (spec 003, D20) y AUDIO_SIGNING_SECRET
    // obligatorio distinto del default. Requerida y SIN default a propósito
    // (review de API-8): con un default "development", olvidarla en
    // producción desactivaba en silencio las tres reglas. Jest setea "test"
    // solo; main.ts loguea el valor efectivo al arrancar.
    NODE_ENV: z.enum(["development", "test", "production"]),

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

    // TtsModule (decision-log.md 2026-09-09, #19/#20) — motor activo para todo
    // el proceso (no por llamada, a diferencia de ModelProviderFactory: los
    // catálogos de voz de los 3 motores son incompatibles entre sí). Default
    // LOCAL: sin key, sin costo, sin riesgo de discontinuación.
    TTS_PROVIDER: z.enum(["LOCAL", "GOOGLE_TTS", "OPENROUTER"]).default("LOCAL"),
    // AC 6.1 (features.md Feature 6) — carpeta base de LocalDiskStorageProvider.
    // Gitignoreada (binarios generados, regenerables desde AudioAsset).
    AUDIO_STORAGE_DIR: z.string().min(1).default("./outputs/audios"),
    // Etapa 3 de TTS (tasks.md sección 5, AC 6.1): secreto HMAC para firmar las
    // URLs temporales de LocalDiskStorageProvider.getSignedUrl(). En local
    // alcanza con el default de desarrollo; con NODE_ENV=production el
    // superRefine de abajo exige uno propio (ADR 0001 punto 5).
    AUDIO_SIGNING_SECRET: z.string().min(1).default(DEFAULT_AUDIO_SIGNING_SECRET),
    AUDIO_URL_TTL_SECONDS: z.coerce.number().default(300),

    // Dónde escucha la API (main.ts). HOST por defecto solo loopback: la API
    // no se expone directo, la alcanza el rewrite de Next (ADR 0001 punto 3).
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),

    // Auth del curador (ADR 0001 punto 2, spec 003 API-8). Las tres sin
    // default a propósito: sin credencial configurada el proceso no arranca,
    // en vez de levantar con una contraseña conocida.
    CURATOR_USERNAME: z.string().min(1),
    // Formato scrypt:<N>:<r>:<p>:<sal>:<hash> (shared/crypto/scrypt-password.ts).
    // Generarlo con `pnpm --filter @ai-trend-debates/api auth:hash-password`.
    CURATOR_PASSWORD_HASH: z.string().refine(isValidPasswordHash, {
      message:
        "debe tener el formato scrypt:<N>:<r>:<p>:<sal>:<hash> (generarlo con el script auth:hash-password, ver setup.md)",
    }),
    // Secreto HMAC del token de sesión. Rotarlo invalida todas las sesiones
    // abiertas (la única forma de revocarlas, ADR 0001 "Consecuencias").
    SESSION_SECRET: z.string().min(32, "debe tener al menos 32 caracteres (ver setup.md para generarlo)"),
  })
  .superRefine((env, ctx) => {
    // Spec 004, D16 (ADR 0002 punto 5): TtsModule enlaza siempre Echogarden,
    // así que con otro TTS_PROVIDER la voz se buscaría en AgentVoice para un
    // proveedor que no es el que sintetiza (Echogarden recibiría "es" de
    // GOOGLE_TTS y elegiría una voz por prefijo sin avisar) y AudioAsset.
    // provider quedaría mal etiquetado. El enum conserva los tres valores
    // porque son los de AudioProvider en la base; lo que se rechaza es
    // arrancar con uno sin motor. Se levanta cuando exista un segundo
    // AudioProvider real (tasks.md §5).
    if (env.TTS_PROVIDER !== "LOCAL") {
      ctx.addIssue({
        code: "custom",
        path: ["TTS_PROVIDER"],
        message: `"${env.TTS_PROVIDER}" no está soportado: el único motor de TTS implementado es el local (Echogarden), así que solo se admite LOCAL. Con otro valor las voces se buscarían para un proveedor que no es el que sintetiza (spec 004, D16)`,
      });
    }
    if (env.NODE_ENV === "production" && env.AUDIO_SIGNING_SECRET === DEFAULT_AUDIO_SIGNING_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["AUDIO_SIGNING_SECRET"],
        message: "en producción no puede conservar el valor por defecto (ADR 0001 punto 5)",
      });
    }
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
