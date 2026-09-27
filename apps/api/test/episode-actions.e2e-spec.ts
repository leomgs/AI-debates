import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';
import type { Env } from './../src/shared/config/env.schema';
import { PrismaService } from './../src/shared/prisma/prisma.service';
import { AgentsService } from './../src/modules/agents/agents.service';
import {
  AUDIO_PROVIDER,
  AUDIO_STORAGE,
} from './../src/modules/tts/tts.tokens';
import { DailyQuotaExceededError } from './../src/modules/ai/ai.errors';
import { TtsProviderUnavailableError } from './../src/modules/tts/tts.errors';
import {
  EpisodeDetailSchema,
  EpisodeVerdictSchema,
} from './../src/modules/episodes/episode-detail.mapper';
import { EpisodeSchema } from './../src/modules/episodes/dto/episode.schema';
import { ArgumentSchema } from './../src/modules/episodes/dto/argument.schema';
import {
  AudioAssetSchema,
  SignedAudioUrlSchema,
} from './../src/modules/episodes/dto/audio-asset.schema';
import { ErrorResponseSchema } from './../src/shared/http/error-response.dto';
import { EpisodeOrchestratorService } from './../src/modules/episodes/episode-orchestrator.service';
import { E2E_CURATOR_PASSWORD, E2E_CURATOR_USERNAME } from './e2e-auth.fixture';

// Spec 003: API-10b (mapeo de errores de proveedor y presupuesto), API-14
// (argumentId de otro episodio) y API-19 (regenerate-verdict y
// verdict.stale) contra AppModule completo, con sesión real y la base de
// test. El LLM se mockea en el borde (AgentsService entero, mismo criterio
// que episodes.integration.spec.ts). Para regenerate-audio se mockea solo el
// motor de TTS (AUDIO_PROVIDER), no TtsService: así el error recorre el
// camino real (EpisodeActionsService → withTtsCall → TtsService →
// provider.synthesize) hasta HttpErrorFilter (review F2-2).
const agentsMock = { judge: jest.fn(), createDebateAgent: jest.fn() };
const audioProviderMock = { synthesize: jest.fn() };
// API-10: storage mockeado para que regenerate-audio no escriba en
// AUDIO_STORAGE_DIR y la URL firmada sea predecible.
const audioStorageMock = {
  save: jest.fn(),
  getSignedUrl: jest.fn(),
  delete: jest.fn(),
};

async function createApp(): Promise<INestApplication<App>> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(AgentsService)
    .useValue(agentsMock)
    .overrideProvider(AUDIO_PROVIDER)
    .useValue(audioProviderMock)
    .overrideProvider(AUDIO_STORAGE)
    .useValue(audioStorageMock)
    .compile();
  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  configureApp(app, app.get<ConfigService<Env, true>>(ConfigService));
  await app.init();
  return app;
}

async function login(app: INestApplication<App>): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ username: E2E_CURATOR_USERNAME, password: E2E_CURATOR_PASSWORD })
    .expect(200);
  const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = setCookie.find((c) => c.startsWith('atd_session='));
  if (!cookie) throw new Error('La respuesta no trae la cookie atd_session');
  return cookie.split(';')[0];
}

// Episodio en PENDING_REVIEW con un debatiente, un juez, un argumento
// OFFICIAL y un veredicto emitido "hace una hora" (en producción, entre el
// veredicto y la curaduría pasan minutos u horas).
async function seedReviewedEpisode(
  prisma: PrismaService,
  overrides: {
    status?: 'PENDING_REVIEW' | 'APPROVED' | 'READY_FOR_RENDER';
    maxLlmCalls?: number;
    language?: 'ES' | 'EN' | 'PT';
  } = {},
) {
  const suffix = randomUUID().slice(0, 8);
  // Voz ES/LOCAL de prueba (AgentVoice, ADR 0002), id visiblemente falso
  // (spec 004, D14): regenerate-audio la resuelve para el proveedor activo.
  const voices = {
    create: { language: 'ES' as const, provider: 'LOCAL' as const, voiceId: 'x' },
  };
  const judge = await prisma.agent.create({
    data: {
      name: `Judge ${suffix}`,
      role: 'JUDGE',
      systemPrompt: '-',
      voices,
    },
  });
  const analyst = await prisma.agent.create({
    data: {
      name: `Analyst ${suffix}`,
      role: 'ANALYST',
      systemPrompt: '-',
      voices,
    },
  });
  const topic = await prisma.topic.create({
    data: { title: 'Un trend', context: 'Un trend' },
  });
  const debate = await prisma.debate.create({ data: { topicId: topic.id } });
  const episode = await prisma.episode.create({
    data: {
      debateId: debate.id,
      title: 'Un trend',
      status: overrides.status ?? 'PENDING_REVIEW',
      maxLlmCalls: overrides.maxLlmCalls ?? 25,
      language: overrides.language ?? 'ES',
    },
  });
  await prisma.episodeUsage.create({
    data: { episodeId: episode.id, llmCalls: 10 },
  });
  await prisma.episodeParticipant.create({
    data: {
      episodeId: episode.id,
      agentId: analyst.id,
      modelProvider: 'GOOGLE',
    },
  });
  await prisma.episodeParticipant.create({
    data: {
      episodeId: episode.id,
      agentId: judge.id,
      modelProvider: 'GOOGLE',
      isJudge: true,
    },
  });
  const round = await prisma.debateRound.create({
    data: { debateId: debate.id, round: 1, type: 'OPENING' },
  });
  const argument = await prisma.argument.create({
    data: {
      debateRoundId: round.id,
      agentId: analyst.id,
      content: 'Argumento original.',
      status: 'OFFICIAL',
    },
  });
  const verdict = await prisma.verdict.create({
    data: {
      debateId: debate.id,
      judgeId: judge.id,
      content: 'Veredicto original.',
      winnerId: analyst.id,
      createdAt: new Date(Date.now() - 60 * 60 * 1000),
    },
  });
  return { episode, debate, judge, analyst, argument, verdict };
}

describe('Acciones de curaduría (e2e): API-10b, API-14 y API-19', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let cookie: string;

  const action = (episodeId: string, name: string, body?: object) => {
    const req = request(app.getHttpServer())
      .post(`/episodes/${episodeId}/actions/${name}`)
      .set('Cookie', cookie);
    return body === undefined ? req : req.send(body);
  };
  const detail = async (episodeId: string) => {
    const res = await request(app.getHttpServer())
      .get(`/episodes/${episodeId}`)
      .set('Cookie', cookie)
      .expect(200);
    return EpisodeDetailSchema.parse(res.body);
  };

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    cookie = await login(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    agentsMock.createDebateAgent.mockReturnValue({
      argue: jest.fn().mockResolvedValue({ content: 'Argumento regenerado.' }),
    });
  });

  describe('API-19: regenerate-verdict y verdict.stale', () => {
    it('edit marca el veredicto como desactualizado y regenerate-verdict lo reemplaza y apaga el aviso', async () => {
      const { episode, argument, verdict, judge, analyst } =
        await seedReviewedEpisode(prisma);

      expect((await detail(episode.id)).debate.verdict).toMatchObject({
        id: verdict.id,
        stale: false,
      });

      await action(episode.id, 'edit', {
        argumentId: argument.id,
        content: 'Texto corregido por el curador.',
      }).expect(201);
      expect((await detail(episode.id)).debate.verdict).toMatchObject({
        id: verdict.id,
        stale: true,
      });

      agentsMock.judge.mockResolvedValue({
        content: 'Veredicto nuevo.',
        winnerAgentId: null,
      });
      const res = await action(episode.id, 'regenerate-verdict', {}).expect(
        201,
      );

      const newVerdict = EpisodeVerdictSchema.parse(res.body);
      expect(newVerdict).toMatchObject({
        judgeId: judge.id,
        content: 'Veredicto nuevo.',
        winnerId: null,
        stale: false,
      });
      expect(newVerdict.id).not.toBe(verdict.id);
      // El juez recibió el argumento OFFICIAL actual (el editado) y el
      // modelProvider de su participante.
      expect(agentsMock.judge).toHaveBeenCalledWith(
        expect.objectContaining({
          officialArguments: [
            expect.objectContaining({
              id: argument.id,
              content: 'Texto corregido por el curador.',
            }),
          ],
        }),
        'GOOGLE',
      );

      const after = await detail(episode.id);
      expect(after.debate.verdict).toEqual(newVerdict);
      expect(after.usage?.llmCalls).toBe(11);

      const archived = await prisma.verdictHistory.findMany({
        where: { debateId: episode.debateId },
      });
      expect(archived).toEqual([
        expect.objectContaining({
          judgeId: judge.id,
          content: 'Veredicto original.',
          winnerId: analyst.id,
          issuedAt: verdict.createdAt,
        }),
      ]);
    });

    it('regenerate también marca el veredicto como desactualizado', async () => {
      const { episode, argument } = await seedReviewedEpisode(prisma);

      await action(episode.id, 'regenerate', {
        argumentId: argument.id,
      }).expect(201);

      expect((await detail(episode.id)).debate.verdict?.stale).toBe(true);
    });

    it('body con campos de más → 400 VALIDATION_ERROR sin llamar al juez', async () => {
      const { episode } = await seedReviewedEpisode(prisma);

      const res = await action(episode.id, 'regenerate-verdict', {
        force: true,
      }).expect(400);

      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(agentsMock.judge).not.toHaveBeenCalled();
    });

    it('fuera de PENDING_REVIEW → 409 INVALID_STATE_TRANSITION', async () => {
      const { episode } = await seedReviewedEpisode(prisma, {
        status: 'APPROVED',
      });

      const res = await action(episode.id, 'regenerate-verdict', {}).expect(
        409,
      );

      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(agentsMock.judge).not.toHaveBeenCalled();
    });

    it('sin presupuesto → 409 USAGE_LIMIT_EXCEEDED con el veredicto anterior intacto', async () => {
      const { episode, verdict } = await seedReviewedEpisode(prisma, {
        maxLlmCalls: 10,
      });

      const res = await action(episode.id, 'regenerate-verdict', {}).expect(
        409,
      );

      expect(res.body.error.code).toBe('USAGE_LIMIT_EXCEEDED');
      expect(agentsMock.judge).not.toHaveBeenCalled();
      expect((await detail(episode.id)).debate.verdict).toMatchObject({
        id: verdict.id,
        content: 'Veredicto original.',
      });
    });

    it('cuota del proveedor agotada → 503 PROVIDER_QUOTA_EXCEEDED, veredicto intacto y cupo devuelto', async () => {
      const { episode, verdict } = await seedReviewedEpisode(prisma);
      agentsMock.judge.mockRejectedValue(
        new DailyQuotaExceededError('GOOGLE', 500),
      );

      const res = await action(episode.id, 'regenerate-verdict', {}).expect(
        503,
      );

      expect(res.body.error.code).toBe('PROVIDER_QUOTA_EXCEEDED');
      const after = await detail(episode.id);
      expect(after.debate.verdict).toMatchObject({
        id: verdict.id,
        content: 'Veredicto original.',
      });
      expect(after.usage?.llmCalls).toBe(10);
      expect(
        await prisma.verdictHistory.count({
          where: { debateId: episode.debateId },
        }),
      ).toBe(0);
    });

    it('cualquier otra falla del juez → 500 INTERNAL_ERROR con el veredicto intacto', async () => {
      const { episode, verdict } = await seedReviewedEpisode(prisma);
      agentsMock.judge.mockRejectedValue(
        new Error('respuesta inválida del modelo'),
      );

      const res = await action(episode.id, 'regenerate-verdict', {}).expect(
        500,
      );

      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect((await detail(episode.id)).debate.verdict).toMatchObject({
        id: verdict.id,
      });
    });
  });

  describe('API-14: argumentId de otro episodio', () => {
    it('edit y regenerate responden 404 NOT_FOUND y no tocan el argumento ajeno', async () => {
      const mine = await seedReviewedEpisode(prisma);
      const other = await seedReviewedEpisode(prisma);

      const edit = await action(mine.episode.id, 'edit', {
        argumentId: other.argument.id,
        content: 'Intruso.',
      }).expect(404);
      expect(edit.body).toEqual({
        error: { code: 'NOT_FOUND', message: expect.any(String) },
      });

      const regenerate = await action(mine.episode.id, 'regenerate', {
        argumentId: other.argument.id,
      }).expect(404);
      expect(regenerate.body.error.code).toBe('NOT_FOUND');

      const untouched = await prisma.argument.findUniqueOrThrow({
        where: { id: other.argument.id },
      });
      expect(untouched).toMatchObject({
        content: 'Argumento original.',
        origin: 'AI_GENERATED',
      });
      expect(
        await prisma.argumentHistory.count({
          where: { argumentId: other.argument.id },
        }),
      ).toBe(0);
      expect(agentsMock.createDebateAgent).not.toHaveBeenCalled();
    });
  });

  describe('API-10b: errores de regenerate y regenerate-audio', () => {
    it('regenerate sin presupuesto → 409 USAGE_LIMIT_EXCEEDED con el argumento intacto', async () => {
      const { episode, argument } = await seedReviewedEpisode(prisma, {
        maxLlmCalls: 10,
      });

      const res = await action(episode.id, 'regenerate', {
        argumentId: argument.id,
      }).expect(409);

      expect(res.body.error.code).toBe('USAGE_LIMIT_EXCEEDED');
      expect(
        await prisma.argument.findUniqueOrThrow({ where: { id: argument.id } }),
      ).toMatchObject({ content: 'Argumento original.' });
    });

    it('regenerate con la cuota del proveedor agotada → 503 PROVIDER_QUOTA_EXCEEDED', async () => {
      const { episode, argument } = await seedReviewedEpisode(prisma);
      agentsMock.createDebateAgent.mockReturnValue({
        argue: jest
          .fn()
          .mockRejectedValue(new DailyQuotaExceededError('GOOGLE', 500)),
      });

      const res = await action(episode.id, 'regenerate', {
        argumentId: argument.id,
      }).expect(503);

      expect(res.body.error.code).toBe('PROVIDER_QUOTA_EXCEEDED');
    });

    it('regenerate-audio con el motor de TTS caído → 503 PROVIDER_QUOTA_EXCEEDED, sin audio nuevo y con el cupo devuelto', async () => {
      const { episode, argument } = await seedReviewedEpisode(prisma, {
        status: 'READY_FOR_RENDER',
      });
      // Lo que hace EchogardenAudioProvider cuando el motor falla.
      audioProviderMock.synthesize.mockRejectedValue(
        new TtsProviderUnavailableError('LOCAL', new Error('echogarden')),
      );
      const audioAssetsBefore = await prisma.audioAsset.count();

      const res = await action(episode.id, 'regenerate-audio', {
        sequenceIndex: 1,
      }).expect(503);

      expect(res.body.error.code).toBe('PROVIDER_QUOTA_EXCEEDED');
      // Llegó al motor real con el texto del segmento 1 y la voz LOCAL del agente.
      expect(audioProviderMock.synthesize).toHaveBeenCalledWith(
        'Argumento original.',
        'x',
      );
      expect(await prisma.audioAsset.count()).toBe(audioAssetsBefore);
      expect(
        await prisma.argument.findUniqueOrThrow({ where: { id: argument.id } }),
      ).toMatchObject({ audioAssetId: null });
      const usage = await prisma.episodeUsage.findUniqueOrThrow({
        where: { episodeId: episode.id },
      });
      expect(usage.ttsRequests).toBe(0);
    });
  });

  // Spec 004, D15 (AC 4.15): los agentes del seed de este archivo solo
  // tienen voz ES, así que un episodio EN no tiene voz para regenerar.
  describe('spec 004: regenerate-audio sin voz para el idioma del episodio', () => {
    it('→ 409 VOICE_NOT_CONFIGURED con idioma, proveedor y agente, sin llamar al motor y con el segmento como estaba', async () => {
      const { episode, argument } = await seedReviewedEpisode(prisma, {
        status: 'READY_FOR_RENDER',
        language: 'EN',
      });
      audioProviderMock.synthesize.mockClear();
      const audioAssetsBefore = await prisma.audioAsset.count();

      const res = await action(episode.id, 'regenerate-audio', {
        sequenceIndex: 1,
      }).expect(409);

      expect(res.body.error.code).toBe('VOICE_NOT_CONFIGURED');
      expect(res.body.error.message).toMatch(/idioma EN/);
      expect(res.body.error.message).toMatch(/"LOCAL"/);
      expect(res.body.error.message).toMatch(/\(ANALYST\)/);
      expect(audioProviderMock.synthesize).not.toHaveBeenCalled();
      expect(await prisma.audioAsset.count()).toBe(audioAssetsBefore);
      expect(
        await prisma.argument.findUniqueOrThrow({ where: { id: argument.id } }),
      ).toMatchObject({ audioAssetId: null });
      const usage = await prisma.episodeUsage.findUniqueOrThrow({
        where: { episodeId: episode.id },
      });
      expect(usage.ttsRequests).toBe(0);
    });
  });

  // API-10: cada acción tiene su operationId y su @ZodResponse en
  // openapi.json. @ZodResponse no valida la respuesta en runtime (no hay
  // ZodSerializerInterceptor registrado): documenta y tipa. Estos tests
  // comparan la respuesta real con el schema documentado, en modo estricto,
  // para que un campo que el schema no declara también falle.
  describe('API-10: respuestas de las acciones contra el schema documentado', () => {
    // El pipeline que approve/resume disparan en segundo plano no es parte
    // de lo que se prueba acá (llamaría a los agentes mockeados).
    const stubPipeline = (method: 'runPipeline' | 'runAudioPipeline') =>
      jest
        .spyOn(app.get(EpisodeOrchestratorService), method)
        .mockResolvedValue(undefined);

    it('approve → 201 con el Episode en APPROVED', async () => {
      const { episode } = await seedReviewedEpisode(prisma);
      const audioPipeline = stubPipeline('runAudioPipeline');
      try {
        const res = await action(episode.id, 'approve').expect(201);

        const body = EpisodeSchema.strict().parse(res.body);
        expect(body).toMatchObject({ id: episode.id, status: 'APPROVED' });
        expect(audioPipeline).toHaveBeenCalledWith(episode.id);
      } finally {
        audioPipeline.mockRestore();
      }
    });

    it('reject → 201 con el Episode en CANCELLED', async () => {
      const { episode } = await seedReviewedEpisode(prisma);

      const res = await action(episode.id, 'reject').expect(201);

      expect(EpisodeSchema.strict().parse(res.body)).toMatchObject({
        id: episode.id,
        status: 'CANCELLED',
      });
    });

    it('resume (USAGE_LIMIT_EXCEEDED) → 201 con el Episode en el estado del checkpoint y el límite nuevo', async () => {
      const { episode } = await seedReviewedEpisode(prisma);
      await prisma.episode.update({
        where: { id: episode.id },
        data: { status: 'REQUIRES_HUMAN_REVIEW' },
      });
      await prisma.episodeCheckpoint.create({
        data: {
          episodeId: episode.id,
          fromState: 'DEBATING',
          reason: 'USAGE_LIMIT_EXCEEDED',
          snapshot: '{}',
        },
      });
      const pipeline = stubPipeline('runPipeline');
      try {
        const res = await action(episode.id, 'resume', {
          maxLlmCalls: 40,
        }).expect(201);

        expect(EpisodeSchema.strict().parse(res.body)).toMatchObject({
          id: episode.id,
          status: 'DEBATING',
          maxLlmCalls: 40,
        });
        expect(pipeline).toHaveBeenCalledWith(episode.id, undefined);
      } finally {
        pipeline.mockRestore();
      }
    });

    it('edit y regenerate → 201 con el Argument', async () => {
      const { episode, argument } = await seedReviewedEpisode(prisma);

      const edited = await action(episode.id, 'edit', {
        argumentId: argument.id,
        content: 'Texto del curador.',
      }).expect(201);
      expect(ArgumentSchema.strict().parse(edited.body)).toMatchObject({
        id: argument.id,
        content: 'Texto del curador.',
        origin: 'HUMAN_EDITED',
        status: 'OFFICIAL',
      });

      const regenerated = await action(episode.id, 'regenerate', {
        argumentId: argument.id,
      }).expect(201);
      expect(ArgumentSchema.strict().parse(regenerated.body)).toMatchObject({
        id: argument.id,
        content: 'Argumento regenerado.',
        status: 'OFFICIAL',
      });
    });

    it('regenerate-verdict → 201 con el veredicto; sin body → 400 VALIDATION_ERROR', async () => {
      const { episode, judge } = await seedReviewedEpisode(prisma);
      agentsMock.judge.mockResolvedValue({
        content: 'Veredicto nuevo.',
        winnerAgentId: null,
      });

      const res = await action(episode.id, 'regenerate-verdict', {}).expect(
        201,
      );
      expect(EpisodeVerdictSchema.strict().parse(res.body)).toMatchObject({
        judgeId: judge.id,
        stale: false,
      });

      const noBody = await action(episode.id, 'regenerate-verdict').expect(400);
      expect(ErrorResponseSchema.parse(noBody.body).error.code).toBe(
        'VALIDATION_ERROR',
      );
    });

    it('regenerate-audio → 201 con el AudioAsset nuevo, y su URL firmada → 200', async () => {
      const { episode, argument } = await seedReviewedEpisode(prisma, {
        status: 'READY_FOR_RENDER',
      });
      audioProviderMock.synthesize.mockResolvedValue({
        audioBuffer: Buffer.from('wav'),
        durationMs: 1200,
        mimeType: 'audio/wav',
        subtitles: [{ text: 'Argumento', startMs: 0, endMs: 600 }],
      });
      audioStorageMock.save.mockResolvedValue(undefined);

      const res = await action(episode.id, 'regenerate-audio', {
        sequenceIndex: 1,
      }).expect(201);

      const asset = AudioAssetSchema.strict().parse(res.body);
      expect(asset).toMatchObject({
        provider: 'LOCAL',
        durationMs: 1200,
        mimeType: 'audio/wav',
        voiceId: 'x',
        subtitles: [{ text: 'Argumento', startMs: 0, endMs: 600 }],
      });
      expect(
        await prisma.argument.findUniqueOrThrow({ where: { id: argument.id } }),
      ).toMatchObject({ audioAssetId: asset.id });

      audioStorageMock.getSignedUrl.mockResolvedValue(
        `/audio-files/${asset.storageKey}?expires=1&sig=abc`,
      );
      const url = await request(app.getHttpServer())
        .get(`/episodes/${episode.id}/audio/${asset.id}/url`)
        .set('Cookie', cookie)
        .expect(200);
      expect(SignedAudioUrlSchema.strict().parse(url.body)).toEqual({
        url: `/audio-files/${asset.storageKey}?expires=1&sig=abc`,
      });
    });

    it('los errores de las acciones salen con el envelope documentado', async () => {
      const { episode } = await seedReviewedEpisode(prisma, {
        status: 'APPROVED',
      });

      const res = await action(episode.id, 'approve').expect(409);

      expect(ErrorResponseSchema.parse(res.body)).toEqual({
        error: {
          code: 'INVALID_STATE_TRANSITION',
          message: expect.any(String),
        },
      });
    });

    // Las HttpException de Nest ya no arman el code con el nombre de la
    // clase (BADREQUEST, NOTFOUND): salen con el code del enum de su status.
    it('HttpException de Nest → code del enum: status inválido en GET /episodes es VALIDATION_ERROR y una ruta inexistente NOT_FOUND', async () => {
      const invalidFilter = await request(app.getHttpServer())
        .get('/episodes?status=NO_EXISTE')
        .set('Cookie', cookie)
        .expect(400);
      expect(ErrorResponseSchema.parse(invalidFilter.body).error.code).toBe(
        'VALIDATION_ERROR',
      );

      const unknownRoute = await request(app.getHttpServer())
        .get('/ruta-que-no-existe')
        .set('Cookie', cookie)
        .expect(404);
      expect(ErrorResponseSchema.parse(unknownRoute.body).error.code).toBe(
        'NOT_FOUND',
      );
    });

    // Antes de API-10 `action` era un path param validado con
    // ActionNameSchema; con un handler por acción, la ruta genérica que queda
    // al final mantiene ese 400 (sin ella sería un 404).
    it('acción desconocida → 400 VALIDATION_ERROR, como antes', async () => {
      const { episode } = await seedReviewedEpisode(prisma);

      const res = await action(episode.id, 'no-existe', {}).expect(400);

      expect(ErrorResponseSchema.parse(res.body).error.code).toBe(
        'VALIDATION_ERROR',
      );
    });
  });
});
