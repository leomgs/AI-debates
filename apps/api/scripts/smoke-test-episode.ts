import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ResearchService } from '../src/modules/research/research.service';
import { DebateService } from '../src/modules/debate/debate.service';
import { EpisodeOrchestratorService } from '../src/modules/episodes/episode-orchestrator.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';

// Smoke test manual, NO automatizado (no es un *.spec.ts) — corre el pipeline
// COMPLETO de EpisodesModule (research -> debate -> fact-check -> veredicto)
// contra APIs reales (Tavily + Gemini, gasta créditos de verdad). A diferencia
// de scripts/smoke-test-argument.ts (que probó el tramo research->argumento
// antes de que EpisodesModule existiera), este llama a
// EpisodeOrchestratorService.runPipeline() real — el mismo método que usa
// EpisodesService.createEpisode() (ahí se dispara fire-and-forget, sin
// esperar) y EpisodeActionsService.resume()/EpisodeRecoveryService. Acá se
// awaitea directo para poder reportar el resultado final en esta misma
// corrida del script.
//
// Rondas recortadas a propósito (openingRounds:1, rebuttalRounds:0,
// crossExaminationRounds:0) para mantener el costo/tiempo bajo — con los
// defaults reales (1/1/1) el pipeline completo se acerca al límite de
// maxLlmCalls (25) solo con 2 agentes x 3 tipos de ronda. Alcanza con OPENING
// para validar que el pipeline entero (incluida la orquestación de
// EpisodesModule, no solo research->argumento) funciona de punta a punta.
//
// Correr con: npx ts-node scripts/smoke-test-episode.ts
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const prisma = app.get(PrismaService);
  const research = app.get(ResearchService);
  const debateService = app.get(DebateService);
  const orchestrator = app.get(EpisodeOrchestratorService);
  const notifications = app.get(NotificationsService);

  console.log('1. Creando Topic + Debate + Episode (rondas recortadas: solo OPENING)...');
  const topic = await research.createTopic(
    '¿Debería la IA reemplazar a los desarrolladores de software?',
    'Trend de discusión pública sobre el impacto de la IA generativa en el trabajo de desarrollo de software.'
  );
  const debateRow = await debateService.createDebate(topic.id);
  const episode = await prisma.episode.create({
    data: {
      debateId: debateRow.id,
      title: topic.title,
      openingRounds: 1,
      rebuttalRounds: 0,
      crossExaminationRounds: 0,
    },
  });
  await prisma.episodeUsage.create({ data: { episodeId: episode.id } });
  console.log(`   Episode creado: ${episode.id} (status inicial: ${episode.status})`);

  console.log('\n2. Corriendo runPipeline() completo (research -> debate -> judging)...');
  console.log('   Esto puede tardar unos minutos — hay varias llamadas secuenciales a Gemini.\n');
  await orchestrator.runPipeline(episode.id);

  const final = await prisma.episode.findUniqueOrThrow({
    where: { id: episode.id },
    include: {
      usage: true,
      checkpoints: { orderBy: { createdAt: 'asc' } },
      debate: {
        include: {
          rounds: { include: { arguments: true }, orderBy: { round: 'asc' } },
          verdict: true,
        },
      },
    },
  });

  console.log(`\n✅ Pipeline terminado. Status final: ${final.status}`);
  console.log(`   Uso: ${JSON.stringify(final.usage)}`);

  if (final.checkpoints.length > 0) {
    console.log(`   Checkpoints creados (${final.checkpoints.length}):`);
    final.checkpoints.forEach((c) => console.log(`   - ${c.reason} (desde ${c.fromState})`));
  }

  const officialArgs = final.debate.rounds.flatMap((r) =>
    r.arguments.filter((a) => a.status === 'OFFICIAL').map((a) => ({ round: r.type, agentId: a.agentId, content: a.content }))
  );
  console.log(`\n   Argumentos OFFICIAL (${officialArgs.length}):`);
  officialArgs.forEach((a, i) => console.log(`   [${i + 1}] (${a.round}, agente ${a.agentId})\n       "${a.content}"`));

  if (final.debate.verdict) {
    console.log(`\n   Veredicto: ${final.debate.verdict.content}`);
    console.log(`   Ganador: ${final.debate.verdict.winnerId ?? '(sin ganador declarado)'}`);
  }

  const unreadNotifications = await notifications.list(true);
  console.log(`\n   Notificaciones sin leer (${unreadNotifications.length}):`);
  unreadNotifications.forEach((n) => console.log(`   - [${n.type}] ${n.message}`));

  await app.close();
}

main().catch((error: unknown) => {
  console.error('❌ Smoke test falló:', error);
  process.exit(1);
});
