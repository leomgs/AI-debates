import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { ResearchService } from '../src/modules/research/research.service';
import { DebateService } from '../src/modules/debate/debate.service';
import { EpisodeOrchestratorService } from '../src/modules/episodes/episode-orchestrator.service';
import { EpisodeStateService } from '../src/modules/episodes/episode-state.service';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import type { Env } from '../src/shared/config/env.schema';

// Smoke test manual, NO automatizado (no es un *.spec.ts) — corre el
// pipeline COMPLETO hasta PENDING_REVIEW (mismo criterio recortado que
// smoke-test-episode.ts) y DESPUÉS la etapa 2 de TTS (tasks.md sección 5):
// aprueba el episodio y sintetiza audio real con el proveedor activo
// (TTS_PROVIDER, LOCAL por default — Echogarden/Piper, gasta tiempo de CPU
// real y descarga modelos de voz la primera vez, no gasta créditos de API).
//
// Usa EpisodeStateService.markApproved() en vez de
// EpisodeActionsService.approve() a propósito: approve() dispara
// runAudioPipeline() fire-and-forget (el comportamiento real de producción),
// pero acá el script necesita awaitear el resultado para poder reportarlo
// en esta misma corrida — se llama runAudioPipeline() directo después.
//
// Correr con: npx ts-node scripts/smoke-test-tts.ts
// Solo con TTS_PROVIDER=LOCAL: mientras Echogarden sea el único motor, el
// proceso no arranca con otro valor (spec 004, D16).
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const prisma = app.get(PrismaService);
  const research = app.get(ResearchService);
  const debateService = app.get(DebateService);
  const orchestrator = app.get(EpisodeOrchestratorService);
  const state = app.get(EpisodeStateService);
  const config = app.get(ConfigService) as ConfigService<Env, true>;

  const ttsProvider = config.get('TTS_PROVIDER', { infer: true });
  const storageDir = config.get('AUDIO_STORAGE_DIR', { infer: true });
  console.log(`TTS_PROVIDER activo: ${ttsProvider} (storage: ${storageDir})`);

  console.log('\n1. Creando Topic + Debate + Episode (rondas recortadas: solo OPENING)...');
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
      // Default (25) puede no alcanzar si el loop de enmienda se dispara
      // (decision-log.md #11/#15/#17) — este script valida TTS, no el
      // presupuesto del debate, así que se le da margen a propósito.
      maxLlmCalls: 40,
    },
  });
  await prisma.episodeUsage.create({ data: { episodeId: episode.id } });
  console.log(`   Episode creado: ${episode.id}`);

  console.log('\n2. Corriendo runPipeline() hasta PENDING_REVIEW (research -> debate -> judging)...');
  await orchestrator.runPipeline(episode.id);

  const afterPipeline = await prisma.episode.findUniqueOrThrow({ where: { id: episode.id } });
  if (afterPipeline.status !== 'PENDING_REVIEW') {
    throw new Error(`Esperaba PENDING_REVIEW antes de aprobar, quedó en ${afterPipeline.status} — revisar checkpoints.`);
  }

  console.log('\n3. Aprobando y corriendo runAudioPipeline() (síntesis real de audio)...');
  await state.markApproved(episode.id);
  await orchestrator.runAudioPipeline(episode.id);

  const final = await prisma.episode.findUniqueOrThrow({
    where: { id: episode.id },
    include: {
      usage: true,
      checkpoints: { orderBy: { createdAt: 'asc' } },
      debate: {
        include: { rounds: { include: { arguments: { include: { audioAsset: true } } }, orderBy: { round: 'asc' } } },
      },
    },
  });

  console.log(`\n✅ Pipeline de audio terminado. Status final: ${final.status}`);
  console.log(`   Uso: ${JSON.stringify(final.usage)}`);
  if (final.checkpoints.length > 0) {
    console.log(`   Checkpoints creados (${final.checkpoints.length}):`);
    final.checkpoints.forEach((c) => console.log(`   - ${c.reason} (desde ${c.fromState})`));
  }

  const officialArgs = final.debate.rounds.flatMap((r) => r.arguments.filter((a) => a.status === 'OFFICIAL'));
  console.log(`\n4. Verificando ${officialArgs.length} argumento(s) OFFICIAL...`);

  let allOk = final.status === 'READY_FOR_RENDER';
  if (!allOk) console.error(`   ❌ Status final esperado READY_FOR_RENDER, fue ${final.status}`);

  for (const arg of officialArgs) {
    if (!arg.audioAsset) {
      console.error(`   ❌ Argument ${arg.id} sin AudioAsset asociado`);
      allOk = false;
      continue;
    }
    const asset = arg.audioAsset;
    const durationOk = asset.durationMs > 0;
    const filePath = join(storageDir, asset.storageKey);
    const fileExists = existsSync(filePath);
    const fileSize = fileExists ? statSync(filePath).size : 0;
    const sizeOk = fileSize > 100; // guarda contra un archivo vacío/truncado

    console.log(
      `   Argument ${arg.id}: provider=${asset.provider} durationMs=${asset.durationMs} file=${filePath} (${fileSize} bytes)`
    );
    if (!durationOk) {
      console.error('   ❌ durationMs no es > 0 — Feature 7 exige duración real, no estimada.');
      allOk = false;
    }
    if (!fileExists || !sizeOk) {
      console.error('   ❌ archivo de audio ausente o con tamaño sospechosamente chico.');
      allOk = false;
    }
  }

  if (allOk) {
    console.log('\n✅ Smoke test de TTS OK: episodio en READY_FOR_RENDER con audio real en disco.');
  } else {
    console.error('\n❌ Smoke test de TTS encontró problemas — ver arriba.');
    process.exitCode = 1;
  }

  await app.close();
}

main().catch((error: unknown) => {
  console.error('❌ Smoke test falló:', error);
  process.exit(1);
});
