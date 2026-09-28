import { Test, TestingModule } from '@nestjs/testing';
import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ModelProviderFactory } from '../ai/model-provider.factory';
import { LlmRateLimiterService } from '../ai/llm-rate-limiter.service';
import { TavilyProvider } from './tavily.provider';
import { ResearchService } from './research.service';
import { InsufficientEvidenceError } from './research.errors';
import { buildLanguageInstruction, describeLanguage } from '../../shared/personas/language-instruction';

// generateObject es el borde real con el AI SDK — se mockea acá (jest-testing
// skill: "mock at the SDK call boundary"), nunca se llama al LLM real.
jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

const mockGenerateObject = generateObject as jest.Mock;
const FAKE_MODEL = { id: 'fake-model' } as unknown as LanguageModel;

const TOPIC_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_A = '22222222-2222-4222-8222-222222222222';
const SOURCE_B = '33333333-3333-4333-8333-333333333333';
const SOURCE_C = '44444444-4444-4444-8444-444444444444';

function persistedSource(id: string, snippet: string) {
  return { id, researchSessionId: 'session-1', title: `Fuente ${id}`, url: `https://example.com/${id}`, snippet, fetchTimestamp: new Date(), publishedAt: null, contentHash: `hash-${id}` };
}

describe('ResearchService', () => {
  let service: ResearchService;
  let prisma: { topic: { create: jest.Mock; findUniqueOrThrow: jest.Mock }; researchSession: { create: jest.Mock }; evidenceFact: { createMany: jest.Mock } };
  let tavily: { search: jest.Mock };
  let modelProviderFactory: { resolve: jest.Mock };

  beforeEach(async () => {
    mockGenerateObject.mockReset();
    prisma = {
      topic: { create: jest.fn(), findUniqueOrThrow: jest.fn() },
      researchSession: { create: jest.fn() },
      evidenceFact: { createMany: jest.fn() },
    };
    tavily = { search: jest.fn() };
    modelProviderFactory = { resolve: jest.fn().mockReturnValue(FAKE_MODEL) };
    const rateLimiter = { acquire: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResearchService,
        { provide: PrismaService, useValue: prisma },
        { provide: TavilyProvider, useValue: tavily },
        { provide: ModelProviderFactory, useValue: modelProviderFactory },
        { provide: LlmRateLimiterService, useValue: rateLimiter },
      ],
    }).compile();

    service = module.get(ResearchService);
  });

  describe('createTopic', () => {
    it('persiste un Topic con title y context', async () => {
      prisma.topic.create.mockResolvedValue({ id: TOPIC_ID, title: 'Un trend', context: 'contexto' });

      const topic = await service.createTopic('Un trend', 'contexto');

      expect(prisma.topic.create).toHaveBeenCalledWith({ data: { title: 'Un trend', context: 'contexto' } });
      expect(topic.id).toBe(TOPIC_ID);
    });
  });

  describe('research', () => {
    it('lanza InsufficientEvidenceError cuando hay menos de 3 fuentes con hash distinto (features.md Feature 1)', async () => {
      prisma.topic.findUniqueOrThrow.mockResolvedValue({ id: TOPIC_ID, title: 'Un trend', context: 'contexto' });
      tavily.search.mockResolvedValue([
        { title: 'A', url: 'https://a.com', content: 'mismo contenido' },
        { title: 'A duplicada', url: 'https://a-mirror.com', content: 'mismo contenido' }, // mismo hash que la anterior
      ]);

      await expect(service.research(TOPIC_ID, 'ES')).rejects.toThrow(InsufficientEvidenceError);
      expect(prisma.researchSession.create).not.toHaveBeenCalled();
    });

    it('deduplica resultados con el mismo contenido antes de persistir Source (AC 1.2)', async () => {
      prisma.topic.findUniqueOrThrow.mockResolvedValue({ id: TOPIC_ID, title: 'Un trend', context: 'contexto' });
      tavily.search.mockResolvedValue([
        { title: 'A', url: 'https://a.com', content: 'contenido A' },
        { title: 'A duplicada', url: 'https://a-mirror.com', content: 'contenido A' }, // dedup: mismo hash
        { title: 'B', url: 'https://b.com', content: 'contenido B' },
        { title: 'C', url: 'https://c.com', content: 'contenido C' },
      ]);
      prisma.researchSession.create.mockResolvedValue({
        id: 'session-1',
        sources: [persistedSource(SOURCE_A, 'contenido A'), persistedSource(SOURCE_B, 'contenido B'), persistedSource(SOURCE_C, 'contenido C')],
      });
      mockGenerateObject.mockResolvedValue({
        object: { topic: 'Un trend', facts: [{ statement: 'Un hecho de A', sourceId: SOURCE_A }] },
      });

      await service.research(TOPIC_ID, 'ES');

      const createCall = prisma.researchSession.create.mock.calls[0][0];
      expect(createCall.data.sources.create).toHaveLength(3); // 4 resultados, 1 duplicado -> 3 fuentes válidas
      expect(createCall.data.topicId).toBe(TOPIC_ID);
    });

    it('extrae EvidenceFact con generateObject usando GOOGLE y los persiste ligados a su sourceId', async () => {
      prisma.topic.findUniqueOrThrow.mockResolvedValue({ id: TOPIC_ID, title: 'Un trend', context: 'contexto' });
      tavily.search.mockResolvedValue([
        { title: 'A', url: 'https://a.com', content: 'contenido A' },
        { title: 'B', url: 'https://b.com', content: 'contenido B' },
        { title: 'C', url: 'https://c.com', content: 'contenido C' },
      ]);
      const persistedSources = [persistedSource(SOURCE_A, 'contenido A'), persistedSource(SOURCE_B, 'contenido B'), persistedSource(SOURCE_C, 'contenido C')];
      prisma.researchSession.create.mockResolvedValue({ id: 'session-1', sources: persistedSources });
      mockGenerateObject.mockResolvedValue({
        object: { topic: 'Un trend', facts: [{ statement: 'Un hecho de A', sourceId: SOURCE_A }, { statement: 'Un hecho de B', sourceId: SOURCE_B }] },
      });

      const result = await service.research(TOPIC_ID, 'ES');

      expect(modelProviderFactory.resolve).toHaveBeenCalledWith('GOOGLE');
      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.model).toBe(FAKE_MODEL);
      expect(call.prompt).toContain(SOURCE_A);
      expect(prisma.evidenceFact.createMany).toHaveBeenCalledWith({
        data: [
          { sourceId: SOURCE_A, content: 'Un hecho de A' },
          { sourceId: SOURCE_B, content: 'Un hecho de B' },
        ],
      });
      expect(result.facts).toHaveLength(2);
    });

    it('suma manualSources al pool antes del chequeo de mínimo — no lanza InsufficientEvidenceError si alcanzan (resume de INSUFFICIENT_EVIDENCE)', async () => {
      prisma.topic.findUniqueOrThrow.mockResolvedValue({ id: TOPIC_ID, title: 'Un trend', context: 'contexto' });
      tavily.search.mockResolvedValue([{ title: 'A', url: 'https://a.com', content: 'contenido A' }]); // solo 1, insuficiente por sí sola
      prisma.researchSession.create.mockResolvedValue({
        id: 'session-1',
        sources: [persistedSource(SOURCE_A, 'contenido A'), persistedSource(SOURCE_B, 'manual B'), persistedSource(SOURCE_C, 'manual C')],
      });
      mockGenerateObject.mockResolvedValue({ object: { topic: 'Un trend', facts: [{ statement: 'Un hecho', sourceId: SOURCE_A }] } });

      await service.research(TOPIC_ID, 'ES', [
        { url: 'https://manual-b.com', title: 'Manual B', snippet: 'manual B' },
        { url: 'https://manual-c.com', title: 'Manual C', snippet: 'manual C' },
      ]);

      const createCall = prisma.researchSession.create.mock.calls[0][0];
      expect(createCall.data.sources.create).toHaveLength(3); // 1 de Tavily + 2 manuales = 3, supera el mínimo
    });

    it('agota los reintentos y rechaza cuando la extracción nunca matchea ResearchOutputSchema (coding-rules.md §3)', async () => {
      prisma.topic.findUniqueOrThrow.mockResolvedValue({ id: TOPIC_ID, title: 'Un trend', context: 'contexto' });
      tavily.search.mockResolvedValue([
        { title: 'A', url: 'https://a.com', content: 'contenido A' },
        { title: 'B', url: 'https://b.com', content: 'contenido B' },
        { title: 'C', url: 'https://c.com', content: 'contenido C' },
      ]);
      prisma.researchSession.create.mockResolvedValue({
        id: 'session-1',
        sources: [persistedSource(SOURCE_A, 'contenido A'), persistedSource(SOURCE_B, 'contenido B'), persistedSource(SOURCE_C, 'contenido C')],
      });
      mockGenerateObject.mockResolvedValue({ object: { topic: 'Un trend', facts: [] } }); // facts vacío falla .min(1)

      await expect(service.research(TOPIC_ID, 'ES')).rejects.toThrow();

      // maxAttempts: 3 en cockatiel = 1 intento inicial + 3 reintentos = 4 invocaciones.
      expect(mockGenerateObject).toHaveBeenCalledTimes(4);
      expect(prisma.evidenceFact.createMany).not.toHaveBeenCalled();
    }, 10_000);

    // Spec 004, D9 (AC 4.7 parte tests, AC 4.13): la búsqueda no cambia
    // (Tavily recibe el título tal cual, sin idioma), y la extracción redacta
    // los hechos en el idioma del episodio, aunque las fuentes estén en otro.
    it.each(['ES', 'EN', 'PT'] as const)('en %s, pide los hechos en ese idioma sin tocar la búsqueda', async (language) => {
      prisma.topic.findUniqueOrThrow.mockResolvedValue({ id: TOPIC_ID, title: 'Un trend', context: 'contexto' });
      tavily.search.mockResolvedValue([
        { title: 'A', url: 'https://a.com', content: 'contenido A' },
        { title: 'B', url: 'https://b.com', content: 'contenido B' },
        { title: 'C', url: 'https://c.com', content: 'contenido C' },
      ]);
      prisma.researchSession.create.mockResolvedValue({
        id: 'session-1',
        sources: [persistedSource(SOURCE_A, 'contenido A'), persistedSource(SOURCE_B, 'contenido B'), persistedSource(SOURCE_C, 'contenido C')],
      });
      mockGenerateObject.mockResolvedValue({ object: { topic: 'Un trend', facts: [{ statement: 'A fact', sourceId: SOURCE_A }] } });

      await service.research(TOPIC_ID, language);

      expect(tavily.search).toHaveBeenCalledWith('Un trend');
      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.system.split('\n\n').at(-1)).toContain(`Redacta cada hecho (statement) en ${describeLanguage(language)}`);
      expect(call.prompt.split('\n\n').at(-1)).toBe(buildLanguageInstruction(language));
    });
  });
});
