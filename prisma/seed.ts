import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
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

// IDs abstractos placeholder para el TTSProvider (Feature 6, todavía no
// implementado — Fase 3 del roadmap). Ajustar cuando se elija el proveedor real.
const DEBATER_VOICE_IDS: Record<DebaterPersona['id'], string> = {
  ANALYST: 'es-male-1',
  CONTRARIAN: 'es-male-2',
  DIPLOMAT: 'es-female-1',
  PROVOCATEUR: 'es-female-2',
};
const JUDGE_VOICE_ID = 'es-neutral-1';

// Snapshot informativo: el prompt real que ve el LLM en cada ronda lo arma
// AgentsService vía buildDebaterSystemPrompt (roundType-específico) — este
// campo de Agent no se lee en runtime del debate.
function debaterSummary(persona: DebaterPersona): string {
  return [
    `Sos ${persona.displayName}, un participante de un debate entre IAs sobre un trend de Internet.`,
    `Tu postura estructural: ${persona.coreStance}`,
    `Tu estilo de argumentación: ${persona.argumentStyle}`,
  ].join('\n\n');
}

// Agent.name no tiene constraint @unique en el schema (ver architecture.md
// §6) — se busca por nombre a mano para que correr el seed dos veces sea
// idempotente en vez de duplicar filas.
async function upsertAgentByName(data: {
  name: string;
  role: string;
  systemPrompt: string;
  voiceId: string;
}) {
  const existing = await prisma.agent.findFirst({ where: { name: data.name } });
  if (existing) {
    await prisma.agent.update({ where: { id: existing.id }, data });
    return;
  }
  await prisma.agent.create({ data });
}

async function main() {
  for (const persona of Object.values(DEBATER_PERSONAS)) {
    await upsertAgentByName({
      name: persona.displayName,
      role: persona.id,
      systemPrompt: debaterSummary(persona),
      voiceId: DEBATER_VOICE_IDS[persona.id],
    });
  }

  await upsertAgentByName({
    name: JUDGE.displayName,
    role: JUDGE.id,
    systemPrompt: buildJudgeSystemPrompt(JUDGE),
    voiceId: JUDGE_VOICE_ID,
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
