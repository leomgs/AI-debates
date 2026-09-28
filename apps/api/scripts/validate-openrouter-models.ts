import "dotenv/config";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { z } from "zod";

// Validación manual, NO automatizada (no es un *.spec.ts) — corre contra la
// API real de OpenRouter (gratis, sin tarjeta) para confirmar si los
// modelos :free que declaran soporte de "structured_outputs" en
// /api/v1/models realmente cumplen el contrato de generateObject que este
// proyecto usa en TODO lado (coding-rules.md §3 — nunca generateText +
// parseo manual). No se integra nada a ModelProviderFactory todavía: es
// exploración previa a decidir si vale la pena agregar OpenRouter como
// provider real (ver conversación 2026-09-08).
//
// Correr con: npx ts-node scripts/validate-openrouter-models.ts
// Requiere OPENROUTER_API_KEY en .env (temporal, no está en env.schema.ts).

const CANDIDATES = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nex-agi/nex-n2.5-pro:free",
  "liquid/lfm-2.5-2.6b:free",
];

// Mismo nivel de complejidad que ClaimExtractionOutputSchema real
// (shared/contracts/agents.contracts.ts) — array anidado + enum, no un
// schema trivial de un solo string. Si un modelo no puede con esto, tampoco
// va a poder con los schemas reales del proyecto.
const TestSchema = z.object({
  claims: z
    .array(
      z.object({
        statement: z.string().min(1),
        type: z.enum(["FACTUAL", "OPINION", "PREDICTION", "SUBJECTIVE"]),
      })
    )
    .min(1),
});

const TEST_ARGUMENT =
  "El 78% de los desarrolladores usa herramientas de IA a diario según el Stack Overflow Developer Survey 2025. " +
  "Sin embargo, creo que la IA nunca podrá reemplazar el criterio arquitectónico humano en sistemas complejos.";

async function validateModel(openrouter: ReturnType<typeof createOpenRouter>, modelId: string) {
  console.log(`\n--- ${modelId} ---`);
  const start = Date.now();
  try {
    const result = await generateObject({
      model: openrouter(modelId),
      schema: TestSchema,
      system: "Eres un extractor de claims. Segmenta el texto en afirmaciones y clasifica cada una en FACTUAL, OPINION, PREDICTION o SUBJECTIVE.",
      prompt: `Argumento a segmentar:\n\n${TEST_ARGUMENT}`,
    });
    const parsed = TestSchema.parse(result.object); // mismo patrón que el resto del proyecto — .parse() adentro
    const elapsedMs = Date.now() - start;
    console.log(`✅ OK (${elapsedMs}ms, ${parsed.claims.length} claims):`);
    parsed.claims.forEach((c) => console.log(`   [${c.type}] ${c.statement}`));
  } catch (error) {
    const elapsedMs = Date.now() - start;
    console.log(`❌ FALLÓ (${elapsedMs}ms)`);
    console.log(`   ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error("❌ Falta OPENROUTER_API_KEY en .env");
    process.exit(1);
  }
  const openrouter = createOpenRouter({ apiKey });

  for (const modelId of CANDIDATES) {
    await validateModel(openrouter, modelId);
  }
}

main().catch((error: unknown) => {
  console.error("❌ Validación falló:", error);
  process.exit(1);
});
