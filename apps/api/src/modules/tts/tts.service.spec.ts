import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TtsService } from './tts.service';
import { AUDIO_PROVIDER, AUDIO_STORAGE } from './tts.tokens';
import { SequenceIndexOutOfRangeError, VoiceNotConfiguredError } from './tts.errors';

const EPISODE_ID = '11111111-1111-4111-8111-111111111111';
const DEBATE_ID = '22222222-2222-4222-8222-222222222222';
const ARGUMENT_ID = '33333333-3333-4333-8333-333333333333';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function argumentWithAgent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ARGUMENT_ID,
    content: 'contenido del argumento',
    // Ids de voz visiblemente ficticios (spec 004, D14). Voces ES y EN para
    // LOCAL, y ES para GOOGLE_TTS: alcanza para ver que se elige por idioma
    // y proveedor a la vez.
    agent: {
      id: 'agent-1',
      name: 'Analista',
      role: 'ANALYST',
      voices: [
        { language: 'ES', provider: 'LOCAL', voiceId: 'test-es-analyst' },
        { language: 'EN', provider: 'LOCAL', voiceId: 'test-en-analyst' },
        { language: 'ES', provider: 'GOOGLE_TTS', voiceId: 'es' },
      ],
    },
    ...overrides,
  };
}

describe('TtsService', () => {
  let service: TtsService;
  let prisma: {
    episode: { findUniqueOrThrow: jest.Mock };
    argument: { findMany: jest.Mock; update: jest.Mock; findFirstOrThrow: jest.Mock };
    audioAsset: { create: jest.Mock; findUnique: jest.Mock; delete: jest.Mock };
    agent: { findMany: jest.Mock };
  };
  let config: { get: jest.Mock };
  let provider: { synthesize: jest.Mock };
  let storage: { save: jest.Mock; getSignedUrl: jest.Mock; delete: jest.Mock };

  beforeEach(async () => {
    prisma = {
      episode: { findUniqueOrThrow: jest.fn() },
      argument: { findMany: jest.fn(), update: jest.fn(), findFirstOrThrow: jest.fn() },
      audioAsset: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
      agent: { findMany: jest.fn() },
    };
    config = { get: jest.fn().mockReturnValue('LOCAL') };
    provider = { synthesize: jest.fn() };
    storage = { save: jest.fn(), getSignedUrl: jest.fn(), delete: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TtsService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: AUDIO_PROVIDER, useValue: provider },
        { provide: AUDIO_STORAGE, useValue: storage },
      ],
    }).compile();

    service = module.get(TtsService);
  });

  describe('getOrderedOfficialArguments', () => {
    it('resuelve debateId del episodio y lista Argument OFFICIAL ordenados por createdAt asc', async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ debateId: DEBATE_ID });
      prisma.argument.findMany.mockResolvedValue([argumentWithAgent()]);

      const result = await service.getOrderedOfficialArguments(EPISODE_ID);

      expect(prisma.episode.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: EPISODE_ID },
        select: { debateId: true },
      });
      expect(prisma.argument.findMany).toHaveBeenCalledWith({
        where: { debateRound: { debateId: DEBATE_ID }, status: 'OFFICIAL' },
        include: { agent: { include: { voices: true } }, audioAsset: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(1);
    });
  });

  describe('synthesizeSegment', () => {
    it('resuelve el voiceId del provider activo, sintetiza, guarda el buffer y enlaza el AudioAsset al Argument', async () => {
      provider.synthesize.mockResolvedValue({
        audioBuffer: Buffer.from('fake-wav-bytes'),
        durationMs: 1234,
        mimeType: 'audio/wav',
        subtitles: [{ text: 'contenido', startMs: 0, endMs: 500 }],
      });
      prisma.audioAsset.create.mockImplementation(({ data }) => Promise.resolve(data));

      const result = await service.synthesizeSegment(EPISODE_ID, argumentWithAgent() as never, 'ES');

      // TTS_PROVIDER=LOCAL (mock de ConfigService) -> usa la fila AgentVoice
      // ES/LOCAL, no la de GOOGLE_TTS ni la EN (ADR 0002).
      expect(provider.synthesize).toHaveBeenCalledWith('contenido del argumento', 'test-es-analyst');

      expect(storage.save).toHaveBeenCalledTimes(1);
      const [storageKey, buffer] = storage.save.mock.calls[0];
      expect(storageKey).toMatch(new RegExp(`^${EPISODE_ID}/[0-9a-f-]+\\.wav$`));
      expect(buffer).toEqual(Buffer.from('fake-wav-bytes'));

      expect(prisma.audioAsset.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.audioAsset.create.mock.calls[0][0].data;
      expect(createArgs.id).toMatch(UUID_RE);
      expect(createArgs.storageKey).toBe(storageKey);
      expect(createArgs.provider).toBe('LOCAL');
      expect(createArgs.durationMs).toBe(1234);
      expect(createArgs.mimeType).toBe('audio/wav');
      // ADR 0002 punto 6: el AudioAsset guarda la voz realmente usada.
      expect(createArgs.voiceId).toBe('test-es-analyst');
      // Feature 7 — subtitles del provider se persisten tal cual en AudioAsset.
      expect(createArgs.subtitles).toEqual([{ text: 'contenido', startMs: 0, endMs: 500 }]);

      expect(prisma.argument.update).toHaveBeenCalledWith({
        where: { id: ARGUMENT_ID },
        data: { audioAssetId: createArgs.id },
      });
      expect(result).toEqual(createArgs);
    });

    it('propaga el error tipado del provider si la síntesis falla (coding-rules.md §5 — no lo swallowea)', async () => {
      const boom = new Error('boom');
      provider.synthesize.mockRejectedValue(boom);

      await expect(service.synthesizeSegment(EPISODE_ID, argumentWithAgent() as never, 'ES')).rejects.toThrow('boom');
      expect(prisma.audioAsset.create).not.toHaveBeenCalled();
      expect(prisma.argument.update).not.toHaveBeenCalled();
    });

    // Spec 004, AC 4.14: la voz que recibe el AudioProvider es la del idioma
    // del episodio, y es la que queda en AudioAsset.voiceId (D17).
    it('con un episodio EN, el AudioProvider recibe la voz EN/LOCAL y el AudioAsset la guarda', async () => {
      provider.synthesize.mockResolvedValue({ audioBuffer: Buffer.from('x'), durationMs: 1, mimeType: 'audio/wav' });
      prisma.audioAsset.create.mockImplementation(({ data }) => Promise.resolve(data));

      await service.synthesizeSegment(EPISODE_ID, argumentWithAgent() as never, 'EN');

      expect(provider.synthesize).toHaveBeenCalledWith('contenido del argumento', 'test-en-analyst');
      expect(prisma.audioAsset.create.mock.calls[0][0].data.voiceId).toBe('test-en-analyst');
    });

    // AC 4.15 / D14: sin fila para el idioma no hay respaldo con la voz ES.
    it('sin voz para el idioma del episodio tira VoiceNotConfiguredError sin sintetizar ni escribir nada', async () => {
      await expect(service.synthesizeSegment(EPISODE_ID, argumentWithAgent() as never, 'PT')).rejects.toThrow(
        VoiceNotConfiguredError
      );
      expect(provider.synthesize).not.toHaveBeenCalled();
      expect(storage.save).not.toHaveBeenCalled();
      expect(prisma.audioAsset.create).not.toHaveBeenCalled();
      expect(prisma.argument.update).not.toHaveBeenCalled();
    });
  });

  describe('regenerateSegmentByIndex (AC 6.2)', () => {
    it('sintetiza de nuevo, swapea el audioAssetId del Argument y limpia (best-effort) el AudioAsset/archivo previos', async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ debateId: DEBATE_ID });
      prisma.argument.findMany.mockResolvedValue([argumentWithAgent({ audioAssetId: 'old-audio-asset' })]);
      provider.synthesize.mockResolvedValue({
        audioBuffer: Buffer.from('nuevo-audio'),
        durationMs: 999,
        mimeType: 'audio/wav',
      });
      prisma.audioAsset.create.mockImplementation(({ data }) => Promise.resolve(data));
      prisma.audioAsset.findUnique.mockResolvedValue({ id: 'old-audio-asset', storageKey: 'ep/old-audio-asset.wav' });
      prisma.audioAsset.delete.mockResolvedValue(undefined);

      const result = await service.regenerateSegmentByIndex(EPISODE_ID, 1, 'ES');

      expect(provider.synthesize).toHaveBeenCalledWith('contenido del argumento', 'test-es-analyst');
      expect(storage.save).toHaveBeenCalledTimes(1);
      const [newStorageKey] = storage.save.mock.calls[0];
      expect(prisma.audioAsset.create).toHaveBeenCalledTimes(1);
      const created = prisma.audioAsset.create.mock.calls[0][0].data;
      expect(created.storageKey).toBe(newStorageKey);

      // Swap de FK: el Argument apunta al AudioAsset NUEVO antes de que se
      // toque el viejo — atomicidad de AC 6.2 (decision-log.md #20 punto 3).
      expect(prisma.argument.update).toHaveBeenCalledWith({
        where: { id: ARGUMENT_ID },
        data: { audioAssetId: created.id },
      });

      expect(prisma.audioAsset.findUnique).toHaveBeenCalledWith({ where: { id: 'old-audio-asset' } });
      expect(storage.delete).toHaveBeenCalledWith('ep/old-audio-asset.wav');
      expect(prisma.audioAsset.delete).toHaveBeenCalledWith({ where: { id: 'old-audio-asset' } });
      expect(result).toEqual(created);
    });

    it('sequenceIndex fuera de rango tira SequenceIndexOutOfRangeError sin sintetizar nada', async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ debateId: DEBATE_ID });
      prisma.argument.findMany.mockResolvedValue([argumentWithAgent()]);

      await expect(service.regenerateSegmentByIndex(EPISODE_ID, 5, 'ES')).rejects.toThrow(SequenceIndexOutOfRangeError);
      expect(provider.synthesize).not.toHaveBeenCalled();
    });

    it('sin audioAssetId previo (segmento nunca sintetizado) no intenta limpiar nada', async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ debateId: DEBATE_ID });
      prisma.argument.findMany.mockResolvedValue([argumentWithAgent({ audioAssetId: null })]);
      provider.synthesize.mockResolvedValue({ audioBuffer: Buffer.from('x'), durationMs: 1, mimeType: 'audio/wav' });
      prisma.audioAsset.create.mockImplementation(({ data }) => Promise.resolve(data));

      await service.regenerateSegmentByIndex(EPISODE_ID, 1, 'ES');

      expect(prisma.audioAsset.findUnique).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.audioAsset.delete).not.toHaveBeenCalled();
    });

    // Spec 004, AC 4.14.
    it('usa la voz del idioma que recibe (EN)', async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ debateId: DEBATE_ID });
      prisma.argument.findMany.mockResolvedValue([argumentWithAgent({ audioAssetId: null })]);
      provider.synthesize.mockResolvedValue({ audioBuffer: Buffer.from('x'), durationMs: 1, mimeType: 'audio/wav' });
      prisma.audioAsset.create.mockImplementation(({ data }) => Promise.resolve(data));

      await service.regenerateSegmentByIndex(EPISODE_ID, 1, 'EN');

      expect(provider.synthesize).toHaveBeenCalledWith('contenido del argumento', 'test-en-analyst');
    });

    // Spec 004, AC 4.15: el segmento queda como estaba.
    it('sin voz para el idioma tira VoiceNotConfiguredError y no toca el segmento ni su audio previo', async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ debateId: DEBATE_ID });
      prisma.argument.findMany.mockResolvedValue([argumentWithAgent({ audioAssetId: 'old-audio-asset' })]);

      await expect(service.regenerateSegmentByIndex(EPISODE_ID, 1, 'PT')).rejects.toThrow(VoiceNotConfiguredError);

      expect(provider.synthesize).not.toHaveBeenCalled();
      expect(storage.save).not.toHaveBeenCalled();
      expect(prisma.audioAsset.create).not.toHaveBeenCalled();
      expect(prisma.argument.update).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.audioAsset.delete).not.toHaveBeenCalled();
    });
  });

  describe('resolveVoiceId (spec 004, ADR 0002 punto 4)', () => {
    const agent = argumentWithAgent().agent as never;

    it('elige la fila de AgentVoice del idioma pedido y del provider activo (TTS_PROVIDER)', () => {
      expect(service.resolveVoiceId(agent, 'ES')).toBe('test-es-analyst');
      expect(service.resolveVoiceId(agent, 'EN')).toBe('test-en-analyst');
    });

    it('sin fila para el idioma y el provider activo tira VoiceNotConfiguredError con idioma, proveedor y agente (D14, D15)', () => {
      let error: unknown;
      try {
        service.resolveVoiceId(agent, 'PT');
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(VoiceNotConfiguredError);
      const voiceError = error as VoiceNotConfiguredError;
      expect(voiceError.language).toBe('PT');
      expect(voiceError.provider).toBe('LOCAL');
      expect(voiceError.agents).toEqual(['Analista (ANALYST)']);
      expect(voiceError.message).toMatch(/idioma PT/);
      expect(voiceError.message).toMatch(/"LOCAL"/);
      expect(voiceError.message).toMatch(/Analista \(ANALYST\)/);
    });

    it('una voz de otro proveedor para el mismo idioma no cuenta (sin respaldo)', () => {
      const soloGoogle = { name: 'Juez', role: 'JUDGE', voices: [{ language: 'ES', provider: 'GOOGLE_TTS', voiceId: 'es' }] };
      expect(() => service.resolveVoiceId(soloGoogle as never, 'ES')).toThrow(VoiceNotConfiguredError);
    });
  });

  describe('assertVoicesConfigured (spec 004, D15)', () => {
    it('consulta AgentVoice por idioma y provider activo, y no tira si todos tienen voz', async () => {
      prisma.agent.findMany.mockResolvedValue([
        { id: 'a1', name: 'Analista', role: 'ANALYST', voices: [{ voiceId: 'test-en-analyst' }] },
        { id: 'a2', name: 'Juez', role: 'JUDGE', voices: [{ voiceId: 'test-en-judge' }] },
      ]);

      await expect(service.assertVoicesConfigured(['a1', 'a2'], 'EN')).resolves.toBeUndefined();

      expect(prisma.agent.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['a1', 'a2'] } },
        select: {
          id: true,
          name: true,
          role: true,
          voices: { where: { language: 'EN', provider: 'LOCAL' }, select: { voiceId: true } },
        },
      });
    });

    it('nombra en un solo error a los agentes sin voz y a los roles sin fila Agent, en el orden recibido', async () => {
      prisma.agent.findMany.mockResolvedValue([
        { id: 'a1', name: 'Analista', role: 'ANALYST', voices: [{ voiceId: 'test-pt-analyst' }] },
        { id: 'a2', name: 'Escéptico', role: 'SKEPTIC', voices: [] },
      ]);

      const promise = service.assertVoicesConfigured(['a1', 'a2'], 'PT', ['JUDGE']);

      await expect(promise).rejects.toThrow(VoiceNotConfiguredError);
      await expect(promise).rejects.toMatchObject({
        language: 'PT',
        provider: 'LOCAL',
        agents: ['Escéptico (SKEPTIC)', 'rol JUDGE (sin fila Agent)'],
      });
    });
  });

  describe('getSignedAudioUrl (AC 6.1)', () => {
    it('scopea el AudioAsset al episodio (debateId) y delega la firma en AudioStorageProvider', async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ debateId: DEBATE_ID });
      prisma.argument.findFirstOrThrow.mockResolvedValue({
        id: ARGUMENT_ID,
        audioAsset: { storageKey: 'ep/asset-1.wav' },
      });
      storage.getSignedUrl.mockResolvedValue('/audio-files/ep/asset-1.wav?expires=1&sig=abc');

      const result = await service.getSignedAudioUrl(EPISODE_ID, 'asset-1');

      expect(prisma.argument.findFirstOrThrow).toHaveBeenCalledWith({
        where: { audioAssetId: 'asset-1', debateRound: { debateId: DEBATE_ID } },
        include: { audioAsset: true },
      });
      expect(storage.getSignedUrl).toHaveBeenCalledWith('ep/asset-1.wav');
      expect(result).toEqual({ url: '/audio-files/ep/asset-1.wav?expires=1&sig=abc' });
    });

    it('propaga el error de Prisma si el audioAssetId no pertenece a este episodio (HttpErrorFilter lo mapea a 404)', async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ debateId: DEBATE_ID });
      const notFound = new Error('P2025');
      prisma.argument.findFirstOrThrow.mockRejectedValue(notFound);

      await expect(service.getSignedAudioUrl(EPISODE_ID, 'de-otro-episodio')).rejects.toThrow(notFound);
      expect(storage.getSignedUrl).not.toHaveBeenCalled();
    });
  });
});
