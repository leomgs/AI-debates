import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ResearchService } from '../src/modules/research/research.service';
import { AgentsService } from '../src/modules/agents/agents.service';
import { DebateService } from '../src/modules/debate/debate.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { ANALYST } from '../src/shared/personas/agents.personas';
import { DebateContext } from '../src/shared/contracts/agents.contracts';

// Smoke test manual, NO automatizado (no es un *.spec.ts) — encadena
// ResearchModule -> DebateModule -> AgentsModule con APIs reales (Tavily +
// Gemini, gasta créditos de verdad) para validar el tramo "research -> primer
// argumento OPENING" antes de que exista EpisodesModule. A propósito NO pasa
// por FactCheckModule todavía. Correr con: npx ts-node scripts/smoke-test-argument.ts
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const prisma = app.get(PrismaService);
  const research = app.get(ResearchService);
  const agents = app.get(AgentsService);
  const debate = app.get(DebateService);

  console.log('1. Creando Topic...');
  const topic = await research.createTopic(
    'La IA va a reemplazar a los programadores en 2026',
    'Trend de discusión pública sobre el impacto de la IA generativa en el trabajo de desarrollo de software.'
  );
  console.log(`   Topic creado: ${topic.id}`);

  console.log('2. Corriendo research() real (Tavily + extracción con Gemini)...');
  // ES: el default de createEpisode (spec 004, D4); este script no crea Episode.
  const researchOutput = await research.research(topic.id, 'ES');
  console.log(`   ${researchOutput.facts.length} facts extraídos:`);
  researchOutput.facts.forEach((f, i) => console.log(`   [${i + 1}] ${f.statement}`));

  console.log('3. Creando Debate + primera DebateRound (OPENING)...');
  const debateRow = await debate.createDebate(topic.id);
  const round = await debate.createRound(debateRow.id, 1, 'OPENING');

  console.log('4. Buscando el Agent "Analyst" seedeado (npm run db:seed)...');
  const analystAgent = await prisma.agent.findFirstOrThrow({ where: { name: 'Analyst' } });

  console.log('5. Generando el primer argumento OPENING (Gemini)...');
  const context: DebateContext = {
    topic: topic.title,
    evidenceBase: researchOutput,
    officialArguments: [],
    participants: [{ agentId: analystAgent.id, personaId: ANALYST.id, displayName: ANALYST.displayName }],
    language: 'ES',
  };
  const debaterAgent = agents.createDebateAgent(ANALYST, 'GOOGLE');
  const draft = await debaterAgent.argue(context, 'OPENING');
  console.log(`   Draft:\n   "${draft.content}"`);

  console.log('6. Persistiendo el Argument y promoviéndolo a OFFICIAL (se salta fact-check a propósito)...');
  const argument = await debate.createDraftArgument(round.id, analystAgent.id, draft.content);
  const official = await debate.promoteToOfficial(argument.id);

  console.log('\n✅ Listo. Argument OFFICIAL persistido:');
  console.log(official);

  await app.close();
}

main().catch((error: unknown) => {
  console.error('❌ Smoke test falló:', error);
  process.exit(1);
});
