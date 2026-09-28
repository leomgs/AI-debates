import 'dotenv/config';
import { AudioProvider, DebateLanguage, PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import {
  DEBATER_PERSONAS,
  JUDGE,
  buildJudgeSystemPrompt,
  DebaterPersona,
} from '../src/shared/personas/agents.personas';

// Script standalone fuera del bootstrap de Nest — no hay ConfigService acá,
// mismo patrón de lectura de DATABASE_URL que prisma.config.ts.
const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? 'file:./dev.db',
  }),
});

type SeedVoice = { language: DebateLanguage; provider: AudioProvider; voiceId: string };

// Voces por agente, idioma y proveedor (tabla AgentVoice, ADR 0002). En el
// MVP de la spec 004 solo hay filas ES (D20): las voces EN/PT se cargan acá
// con la mejora "Voces EN/PT" (tasks.md §13.11). Sin placeholders ("TBD") ni
// filas de OPENROUTER: una voz que no se verificó no se inserta (D14).
// LOCAL: nombres reales del catálogo Piper/vits de echogarden, confirmados
// corriendo `Echogarden.requestVoiceList({ engine: 'vits', language: 'es' })`
// contra el paquete real (7 voces es-ES/es-MX disponibles hoy, 1 sola
// femenina — es_MX-claude-high). Se priorizan tiers "medium"/"high" (mejor
// calidad que "low"/"x_low") y se evita repetir voz entre personas.
// GOOGLE_TTS es la misma "es" para los 5 agentes a propósito: google-tts-api
// tiene una sola voz por idioma, no diferencia por persona (limitación de
// producto conocida, no un bug — ver tasks.md sección 5).
function spanishVoices(localVoiceId: string): SeedVoice[] {
  return [
    { language: 'ES', provider: 'LOCAL', voiceId: localVoiceId },
    { language: 'ES', provider: 'GOOGLE_TTS', voiceId: 'es' },
  ];
}

const DEBATER_VOICES: Record<DebaterPersona['id'], SeedVoice[]> = {
  ANALYST: spanishVoices('es_ES-davefx-medium'),
  CONTRARIAN: spanishVoices('es_ES-sharvard-medium'),
  DIPLOMAT: spanishVoices('es_MX-claude-high'),
  PROVOCATEUR: spanishVoices('es_MX-ald-medium'),
};
const JUDGE_VOICES: SeedVoice[] = spanishVoices('es_ES-mls_10246-low');

// Snapshot informativo: el prompt real que ve el LLM en cada ronda lo arma
// AgentsService vía buildDebaterSystemPrompt (roundType-específico) — este
// campo de Agent no se lee en runtime del debate.
function debaterSummary(persona: DebaterPersona): string {
  return [
    `Eres ${persona.displayName}, un participante de un debate entre IAs sobre un trend de Internet.`,
    `Tu postura estructural: ${persona.coreStance}`,
    `Tu estilo de argumentación: ${persona.argumentStyle}`,
  ].join('\n\n');
}

// Agent.name es @unique (migración 20260908100801_agent_name_unique) y las
// voces tienen PK (agentId, language, provider): los dos upserts hacen que
// correr el seed dos veces no duplique ni cambie filas.
async function upsertAgent(data: { name: string; role: string; systemPrompt: string; voices: SeedVoice[] }) {
  const { voices, ...agentData } = data;
  const agent = await prisma.agent.upsert({
    where: { name: agentData.name },
    create: agentData,
    update: agentData,
  });

  for (const voice of voices) {
    await prisma.agentVoice.upsert({
      where: {
        agentId_language_provider: { agentId: agent.id, language: voice.language, provider: voice.provider },
      },
      create: { agentId: agent.id, ...voice },
      update: { voiceId: voice.voiceId },
    });
  }
}

async function main() {
  for (const persona of Object.values(DEBATER_PERSONAS)) {
    await upsertAgent({
      name: persona.displayName,
      role: persona.id,
      systemPrompt: debaterSummary(persona),
      voices: DEBATER_VOICES[persona.id],
    });
  }

  await upsertAgent({
    name: JUDGE.displayName,
    role: JUDGE.id,
    // Snapshot informativo, como debaterSummary (Agent.systemPrompt no se
    // lee en runtime). Lleva la regla de idioma de ES, el default (spec 004,
    // D4); el prompt real del juez lo arma AgentsService con el idioma de
    // cada episodio.
    systemPrompt: buildJudgeSystemPrompt(JUDGE, 'ES'),
    voices: JUDGE_VOICES,
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
