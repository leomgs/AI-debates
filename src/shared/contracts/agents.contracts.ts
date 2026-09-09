import { z } from "zod";

// ============================================================
// Enums compartidos — deben espejar los enums de schema.prisma
// ============================================================

export const ClaimType = z.enum(["FACTUAL", "OPINION", "PREDICTION", "SUBJECTIVE"]);
export type ClaimType = z.infer<typeof ClaimType>;

export const FactCheckVeracity = z.enum([
  "TRUE",
  "FALSE",
  "MISLEADING",
  "UNSUPPORTED",
  "CONTESTED",
]);
export type FactCheckVeracity = z.infer<typeof FactCheckVeracity>;

export const RoundType = z.enum(["OPENING", "REBUTTAL", "CROSS_EXAMINATION"]);
export type RoundType = z.infer<typeof RoundType>;

// ============================================================
// Feature 1 — Research / Evidence Base
// El LLM procesa resultados de búsqueda YA persistidos como Source
// (con su contentHash/url ya calculados por el backend). Por eso el
// modelo referencia un sourceId, no repite la URL/hash a mano: pedirle
// que reescriba el hash agrega una vía de alucinación innecesaria
// cuando el backend ya tiene esa relación resuelta.
// ============================================================

export const ExtractedFactSchema = z.object({
  statement: z.string().min(1),
  sourceId: z.string().uuid(), // debe matchear una Source ya persistida en esta ResearchSession
});

export const ResearchOutputSchema = z.object({
  topic: z.string().min(1),
  facts: z.array(ExtractedFactSchema).min(1),
});
export type ResearchOutput = z.infer<typeof ResearchOutputSchema>;

// ============================================================
// Feature 2 — Generación de argumentos (OPENING / REBUTTAL)
// Output crudo del LLM: solo el texto. status=DRAFT, origin=AI_GENERATED
// y debateRoundId los asigna el orquestador — no son decisión del modelo.
// ============================================================

export const ArgumentDraftSchema = z.object({
  content: z.string().min(1).max(2000),
});
export type ArgumentDraft = z.infer<typeof ArgumentDraftSchema>;

// CROSS_EXAMINATION: además del texto, el modelo declara a qué
// argumento puntual está respondiendo (Argument.respondsToId).
export const CrossExaminationDraftSchema = ArgumentDraftSchema.extend({
  respondsToId: z.string().uuid(),
});
export type CrossExaminationDraft = z.infer<typeof CrossExaminationDraftSchema>;

// ============================================================
// Feature 3 — Claim Extraction & Fact-Checking
// ============================================================

export const ExtractedClaimSchema = z.object({
  statement: z.string().min(1),
  type: ClaimType,
});

export const ClaimExtractionOutputSchema = z.object({
  claims: z.array(ExtractedClaimSchema),
});
export type ClaimExtractionOutput = z.infer<typeof ClaimExtractionOutputSchema>;

// Ruteo FACTUAL → Fact-Checking Estricto contra la Evidence Base
export const FactCheckOutputSchema = z.object({
  veracity: FactCheckVeracity,
  analysis: z.string().min(1),
  sourceIds: z.array(z.string().uuid()).min(1), // trazabilidad obligatoria — AC 1.2
});
export type FactCheckOutput = z.infer<typeof FactCheckOutputSchema>;

// Ruteo OPINION / PREDICTION / SUBJECTIVE → Filtro Editorial / Persona
export const EditorialReviewOutputSchema = z
  .object({
    passed: z.boolean(),
    violatedRule: z.string().optional(), // solo si passed = false
    reason: z.string().optional(),
  })
  .refine((v) => v.passed || (v.violatedRule && v.reason), {
    message: "Si passed=false, violatedRule y reason son obligatorios",
  });
export type EditorialReviewOutput = z.infer<typeof EditorialReviewOutputSchema>;

// Loop de Enmienda: feedback estructurado que vuelve al agente cuando un
// borrador falla por claim FALSE/MISLEADING o por romper la persona.
// Máximo max_revision_attempts (Episode) antes de REQUIRES_HUMAN_REVIEW.
export const AmendmentFeedbackSchema = z.object({
  reason: z.enum(["FACTUAL_ERROR", "PERSONA_VIOLATION"]),
  failedClaim: z.string().optional(), // presente si reason = FACTUAL_ERROR
  details: z.string().min(1),
});
export type AmendmentFeedback = z.infer<typeof AmendmentFeedbackSchema>;

// ============================================================
// Judge — Verdict
// ============================================================

export const VerdictOutputSchema = z.object({
  content: z.string().min(1),
  winnerAgentId: z.string().uuid().nullable(),
});
export type VerdictOutput = z.infer<typeof VerdictOutputSchema>;

// ============================================================
// DebateAgent — interfaz runtime (idea original, actualizada a las
// fases tipadas de RoundType y a respondsToId para cross-examination)
// ============================================================

// Definido acá (no en agents.personas.ts) para que DebateContext pueda
// referenciarlo sin crear un import circular — agents.personas.ts ya
// depende de este archivo para RoundType, así que DebaterPersona.id usa
// este mismo tipo en vez de duplicar el union.
export type DebaterPersonaId = "ANALYST" | "CONTRARIAN" | "DIPLOMAT" | "PROVOCATEUR";

export interface DebateContext {
  topic: string;
  evidenceBase: ResearchOutput;
  // Feature 2 (Promoción de Argumentos): un agente solo puede leer
  // intervenciones OFFICIAL — los DRAFT del oponente están aislados.
  officialArguments: Array<{
    id: string;
    agentId: string;
    content: string;
    roundType: RoundType;
  }>;
  // Identidad de quienes debaten en este episodio (Judge no participa acá,
  // no es un "agentId" citable en officialArguments). Permite resolver
  // agentId -> displayName al armar la transcripción (en vez de un UUID
  // crudo) y que cada DebaterAgent identifique a su oponente por personaId.
  participants: Array<{
    agentId: string;
    personaId: DebaterPersonaId;
    displayName: string;
  }>;
}

// research(topic) NO es parte de este contrato: según architecture.md §4/§7.1,
// EpisodesModule.runResearch() llama a ResearchModule.research(topic) una sola
// vez por episodio, antes del loop de rondas — ningún DebateAgent lo invoca ni
// lo implementa. Pendiente: definir esa firma (probablemente
// ResearchService.research(topic): Promise<ResearchOutput>) al construir
// ResearchModule (tasks.md sección 1, todavía no existe).
export interface DebateAgent {
  // roundType es OPENING o REBUTTAL acá (CROSS_EXAMINATION tiene su propio
  // método, respond) — condiciona el framing del system prompt.
  argue(context: DebateContext, roundType: "OPENING" | "REBUTTAL"): Promise<ArgumentDraft>;

  // CROSS_EXAMINATION — recibe el argumento puntual a responder
  respond(
    context: DebateContext,
    target: DebateContext["officialArguments"][number]
  ): Promise<CrossExaminationDraft>;

  // Re-generación tras un AmendmentFeedback (Loop de Enmienda). roundType es
  // el de la intervención original que se está enmendando — determina tanto
  // el framing del prompt como qué schema (ArgumentDraft/CrossExamination)
  // corresponde re-validar.
  amend(
    context: DebateContext,
    original: ArgumentDraft | CrossExaminationDraft,
    feedback: AmendmentFeedback,
    roundType: RoundType
  ): Promise<ArgumentDraft | CrossExaminationDraft>;
}