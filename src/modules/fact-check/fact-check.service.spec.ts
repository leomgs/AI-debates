import { Test, TestingModule } from '@nestjs/testing';
import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ModelProviderFactory } from '../ai/model-provider.factory';
import { LlmRateLimiterService } from '../ai/llm-rate-limiter.service';
import { FactCheckService } from './fact-check.service';
import { ANALYST } from '../../shared/personas/agents.personas';
import { DebateContext } from '../../shared/contracts/agents.contracts';

// generateObject es el borde real con el AI SDK — se mockea acá (jest-testing
// skill: "mock at the SDK call boundary"), nunca se llama al LLM real.
jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

const mockGenerateObject = generateObject as jest.Mock;
const FAKE_MODEL = { id: 'fake-model' } as unknown as LanguageModel;

const ARGUMENT_ID = '11111111-1111-4111-8111-111111111111';
const CLAIM_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_A = '33333333-3333-4333-8333-333333333333';

function buildEvidenceBase(): DebateContext['evidenceBase'] {
  return { topic: 'un trend', facts: [{ statement: 'dato verificado', sourceId: SOURCE_A }] };
}

describe('FactCheckService', () => {
  let service: FactCheckService;
  let prisma: { claim: { create: jest.Mock }; factCheck: { create: jest.Mock } };
  let modelProviderFactory: { resolve: jest.Mock };

  beforeEach(async () => {
    mockGenerateObject.mockReset();
    prisma = { claim: { create: jest.fn() }, factCheck: { create: jest.fn() } };
    modelProviderFactory = { resolve: jest.fn().mockReturnValue(FAKE_MODEL) };
    const rateLimiter = { acquire: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FactCheckService,
        { provide: PrismaService, useValue: prisma },
        { provide: ModelProviderFactory, useValue: modelProviderFactory },
        { provide: LlmRateLimiterService, useValue: rateLimiter },
      ],
    }).compile();

    service = module.get(FactCheckService);
  });

  describe('extractClaims', () => {
    it('segmenta el draft y persiste cada claim con su type', async () => {
      mockGenerateObject.mockResolvedValue({
        object: { claims: [{ statement: 'Un 40% adopta IA', type: 'FACTUAL' }, { statement: 'Esto es genial', type: 'OPINION' }] },
      });
      prisma.claim.create
        .mockResolvedValueOnce({ id: 'claim-1', argumentId: ARGUMENT_ID, statement: 'Un 40% adopta IA', type: 'FACTUAL' })
        .mockResolvedValueOnce({ id: 'claim-2', argumentId: ARGUMENT_ID, statement: 'Esto es genial', type: 'OPINION' });

      const claims = await service.extractClaims(ARGUMENT_ID, 'Un 40% adopta IA. Esto es genial.', 'GOOGLE');

      expect(modelProviderFactory.resolve).toHaveBeenCalledWith('GOOGLE');
      expect(prisma.claim.create).toHaveBeenNthCalledWith(1, {
        data: { argumentId: ARGUMENT_ID, statement: 'Un 40% adopta IA', type: 'FACTUAL' },
      });
      expect(prisma.claim.create).toHaveBeenNthCalledWith(2, {
        data: { argumentId: ARGUMENT_ID, statement: 'Esto es genial', type: 'OPINION' },
      });
      expect(claims).toHaveLength(2);
    });
  });

  describe('check', () => {
    it('persiste el FactCheck conectado al Claim y a las Source citadas', async () => {
      mockGenerateObject.mockResolvedValue({
        object: { veracity: 'FALSE', analysis: 'La fuente dice lo contrario', sourceIds: [SOURCE_A] },
      });
      prisma.factCheck.create.mockResolvedValue({ id: 'fc-1' });
      const claim = { id: CLAIM_ID, argumentId: ARGUMENT_ID, statement: 'un dato falso', type: 'FACTUAL' as const };

      const output = await service.check(claim, buildEvidenceBase(), 'ANTHROPIC');

      expect(modelProviderFactory.resolve).toHaveBeenCalledWith('ANTHROPIC');
      expect(output.veracity).toBe('FALSE');
      expect(prisma.factCheck.create).toHaveBeenCalledWith({
        data: {
          claimId: CLAIM_ID,
          veracity: 'FALSE',
          analysis: 'La fuente dice lo contrario',
          sources: { connect: [{ id: SOURCE_A }] },
        },
      });
      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.prompt).toContain('un dato falso');
      expect(call.prompt).toContain(SOURCE_A);
    });
  });

  describe('editorialReview', () => {
    it('devuelve el resultado sin persistir nada (no hay tabla propia en el schema)', async () => {
      mockGenerateObject.mockResolvedValue({ object: { passed: true } });
      const claim = { id: CLAIM_ID, argumentId: ARGUMENT_ID, statement: 'una opinión fuerte', type: 'OPINION' as const };

      const output = await service.editorialReview(claim, ANALYST, 'GOOGLE', 'Un argumento completo con datos y esta opinión fuerte al final.');

      expect(output.passed).toBe(true);
      expect(prisma.claim.create).not.toHaveBeenCalled();
      expect(prisma.factCheck.create).not.toHaveBeenCalled();
      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.system).toContain(ANALYST.displayName);
      expect(call.prompt).toContain('una opinión fuerte');
      // Bug real corrigido (decision-log.md 2026-09-08 #11/#12): el prompt
      // debe incluir el argumento completo, no solo el claim aislado — así
      // el editor puede ver el respaldo que vive en otra oración del mismo
      // argumento en vez de rechazar afirmaciones bien fundamentadas.
      expect(call.prompt).toContain('Un argumento completo con datos y esta opinión fuerte al final.');
    });

    it('agota los reintentos y rechaza cuando el output nunca matchea EditorialReviewOutputSchema (coding-rules.md §3)', async () => {
      mockGenerateObject.mockResolvedValue({ object: { passed: false } }); // passed=false sin violatedRule/reason -> falla el .refine()
      const claim = { id: CLAIM_ID, argumentId: ARGUMENT_ID, statement: 'algo', type: 'OPINION' as const };

      await expect(service.editorialReview(claim, ANALYST, 'GOOGLE', 'Un argumento completo.')).rejects.toThrow();

      // maxAttempts: 3 en cockatiel = 1 intento inicial + 3 reintentos = 4 invocaciones.
      expect(mockGenerateObject).toHaveBeenCalledTimes(4);
    }, 10_000);
  });
});
