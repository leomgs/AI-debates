import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TtsService } from './tts.service';
import { AUDIO_PROVIDER, AUDIO_STORAGE } from './tts.tokens';
import { SequenceIndexOutOfRangeError } from './tts.errors';

const EPISODE_ID = '11111111-1111-4111-8111-111111111111';
const DEBATE_ID = '22222222-2222-4222-8222-222222222222';
const ARGUMENT_ID = '33333333-3333-4333-8333-333333333333';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function argumentWithAgent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ARGUMENT_ID,
    content: 'contenido del argumento',
    agent: {
      id: 'agent-1',
      voices: [
        { provider: 'LOCAL', voiceId: 'es_ES-davefx-medium' },
        { provider: 'GOOGLE_TTS', voiceId: 'es' },
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
  };
  let config: { get: jest.Mock };
  let provider: { synthesize: jest.Mock };
  let storage: { save: jest.Mock; getSignedUrl: jest.Mock; delete: jest.Mock };

  beforeEach(async () => {
    prisma = {
      episode: { findUniqueOrThrow: jest.fn() },
      argument: { findMany: jest.fn(), update: jest.fn(), findFirstOrThrow: jest.fn() },
      audioAsset: { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
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
        include: { agent: { include: { voices: { where: { language: 'ES' } } } }, audioAsset: true },
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

      const result = await service.synthesizeSegment(EPISODE_ID, argumentWithAgent() as never);

      // TTS_PROVIDER=LOCAL (mock de ConfigService) -> usa la fila AgentVoice
      // LOCAL, no la de GOOGLE_TTS (ADR 0002).
      expect(provider.synthesize).toHaveBeenCalledWith('contenido del argumento', 'es_ES-davefx-medium');

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
      expect(createArgs.voiceId).toBe('es_ES-davefx-medium');
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

      await expect(service.synthesizeSegment(EPISODE_ID, argumentWithAgent() as never)).rejects.toThrow('boom');
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

      const result = await service.regenerateSegmentByIndex(EPISODE_ID, 1);

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

      await expect(service.regenerateSegmentByIndex(EPISODE_ID, 5)).rejects.toThrow(SequenceIndexOutOfRangeError);
      expect(provider.synthesize).not.toHaveBeenCalled();
    });

    it('sin audioAssetId previo (segmento nunca sintetizado) no intenta limpiar nada', async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue({ debateId: DEBATE_ID });
      prisma.argument.findMany.mockResolvedValue([argumentWithAgent({ audioAssetId: null })]);
      provider.synthesize.mockResolvedValue({ audioBuffer: Buffer.from('x'), durationMs: 1, mimeType: 'audio/wav' });
      prisma.audioAsset.create.mockImplementation(({ data }) => Promise.resolve(data));

      await service.regenerateSegmentByIndex(EPISODE_ID, 1);

      expect(prisma.audioAsset.findUnique).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
      expect(prisma.audioAsset.delete).not.toHaveBeenCalled();
    });
  });

  describe('resolveVoiceId (Feature 7)', () => {
    it('elige la fila de AgentVoice del provider activo (TTS_PROVIDER)', () => {
      const voiceId = service.resolveVoiceId([
        { provider: 'GOOGLE_TTS', voiceId: 'es' },
        { provider: 'LOCAL', voiceId: 'es_ES-davefx-medium' },
      ]);
      expect(voiceId).toBe('es_ES-davefx-medium');
    });

    it('sin fila para el provider activo tira error en vez de devolver undefined (spec 004, D14)', () => {
      expect(() => service.resolveVoiceId([{ provider: 'GOOGLE_TTS', voiceId: 'es' }])).toThrow(/LOCAL/);
    });

    it('sin voz no sintetiza nada', async () => {
      await expect(
        service.synthesizeSegment(EPISODE_ID, argumentWithAgent({ agent: { id: 'agent-1', voices: [] } }) as never)
      ).rejects.toThrow(/AgentVoice/);
      expect(provider.synthesize).not.toHaveBeenCalled();
      expect(prisma.audioAsset.create).not.toHaveBeenCalled();
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
