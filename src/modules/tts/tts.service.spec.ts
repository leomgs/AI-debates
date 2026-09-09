import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TtsService } from './tts.service';
import { AUDIO_PROVIDER, AUDIO_STORAGE } from './tts.tokens';

const EPISODE_ID = '11111111-1111-4111-8111-111111111111';
const DEBATE_ID = '22222222-2222-4222-8222-222222222222';
const ARGUMENT_ID = '33333333-3333-4333-8333-333333333333';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function argumentWithAgent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ARGUMENT_ID,
    content: 'contenido del argumento',
    agent: { id: 'agent-1', voiceId: { LOCAL: 'es_ES-davefx-medium', GOOGLE_TTS: 'es', OPENROUTER: 'TBD' } },
    ...overrides,
  };
}

describe('TtsService', () => {
  let service: TtsService;
  let prisma: {
    episode: { findUniqueOrThrow: jest.Mock };
    argument: { findMany: jest.Mock; update: jest.Mock };
    audioAsset: { create: jest.Mock };
  };
  let config: { get: jest.Mock };
  let provider: { synthesize: jest.Mock };
  let storage: { save: jest.Mock; getSignedUrl: jest.Mock; delete: jest.Mock };

  beforeEach(async () => {
    prisma = {
      episode: { findUniqueOrThrow: jest.fn() },
      argument: { findMany: jest.fn(), update: jest.fn() },
      audioAsset: { create: jest.fn() },
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
        include: { agent: true },
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
      });
      prisma.audioAsset.create.mockImplementation(({ data }) => Promise.resolve(data));

      const result = await service.synthesizeSegment(EPISODE_ID, argumentWithAgent() as never);

      // TTS_PROVIDER=LOCAL (mock de ConfigService) -> lee voiceMap.LOCAL, no
      // GOOGLE_TTS/OPENROUTER (decision-log.md 2026-09-09, #20 punto 1).
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
});
