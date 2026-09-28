import { Test, TestingModule } from '@nestjs/testing';
import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ModelProviderFactory } from '../ai/model-provider.factory';
import { LlmRateLimiterService } from '../ai/llm-rate-limiter.service';
import { FactCheckService } from './fact-check.service';
import { ANALYST } from '../../shared/personas/agents.personas';
import { DebateContext } from '../../shared/contracts/agents.contracts';
import { buildLanguageInstruction, describeLanguage } from '../../shared/personas/language-instruction';
import { VOSEO } from '../../shared/personas/voseo.test-helper';

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

      const claims = await service.extractClaims(ARGUMENT_ID, 'Un 40% adopta IA. Esto es genial.', 'GOOGLE', 'ES');

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

      const output = await service.check(claim, buildEvidenceBase(), 'ANTHROPIC', 'ES');

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

      const output = await service.editorialReview(claim, ANALYST, 'GOOGLE', 'Un argumento completo con datos y esta opinión fuerte al final.', 'ES');

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

      await expect(service.editorialReview(claim, ANALYST, 'GOOGLE', 'Un argumento completo.', 'ES')).rejects.toThrow();

      // maxAttempts: 3 en cockatiel = 1 intento inicial + 3 reintentos = 4 invocaciones.
      expect(mockGenerateObject).toHaveBeenCalledTimes(4);
    }, 10_000);
  });

  // Spec 004, D7 y AC 4.7 (parte tests): las tres evaluadoras reciben el
  // idioma del episodio. El system prompt dice en qué idioma está el texto
  // evaluado y en cuál se escriben los campos libres (statement, analysis,
  // violatedRule, reason), y el prompt de usuario termina con la instrucción
  // en el idioma de destino.
  describe('idioma del episodio (spec 004, AC 4.7)', () => {
    const LANGUAGES = ['ES', 'EN', 'PT'] as const;
    const CLAIM = { id: CLAIM_ID, argumentId: ARGUMENT_ID, statement: 'a claim', type: 'OPINION' as const };

    function expectLanguage(call: { system: string; prompt: string }, language: (typeof LANGUAGES)[number], freeFields: string[]) {
      // AC 4.26: ni el system ni el prompt de usuario que llegan al SDK tienen voseo.
      expect(call.system).not.toMatch(VOSEO);
      expect(call.prompt).not.toMatch(VOSEO);
      const idiomaRule = call.system.split('\n\n').find((paragraph) => paragraph.startsWith('Idioma:'))!;
      expect(idiomaRule).toContain(describeLanguage(language));
      for (const field of freeFields) expect(idiomaRule).toContain(field);
      expect(call.prompt.split('\n\n').at(-1)).toBe(buildLanguageInstruction(language));
      for (const other of LANGUAGES.filter((l) => l !== language)) {
        expect(call.system).not.toContain(describeLanguage(other));
        expect(call.prompt).not.toContain(buildLanguageInstruction(other));
      }
    }

    it.each(LANGUAGES)('extractClaims en %s: idioma del argumento y de cada statement', async (language) => {
      mockGenerateObject.mockResolvedValue({ object: { claims: [] } });

      await service.extractClaims(ARGUMENT_ID, 'An argument.', 'GOOGLE', language);

      const call = mockGenerateObject.mock.calls[0][0];
      expectLanguage(call, language, ['statement']);
      expect(call.system).toContain(`el argumento está escrito en ${describeLanguage(language)}`);
    });

    it.each(LANGUAGES)('check en %s: idioma de la afirmación y del analysis', async (language) => {
      mockGenerateObject.mockResolvedValue({ object: { veracity: 'TRUE', analysis: 'ok', sourceIds: [SOURCE_A] } });
      prisma.factCheck.create.mockResolvedValue({ id: 'fc-1' });

      await service.check({ ...CLAIM, type: 'FACTUAL' }, buildEvidenceBase(), 'GOOGLE', language);

      const call = mockGenerateObject.mock.calls[0][0];
      expectLanguage(call, language, ['analysis']);
      expect(call.system).toContain(`la afirmación a verificar está escrita en ${describeLanguage(language)}`);
    });

    it.each(LANGUAGES)('editorialReview en %s: idioma del texto, de violatedRule y de reason', async (language) => {
      mockGenerateObject.mockResolvedValue({ object: { passed: true } });

      await service.editorialReview(CLAIM, ANALYST, 'GOOGLE', 'The whole argument.', language);

      const call = mockGenerateObject.mock.calls[0][0];
      expectLanguage(call, language, ['violatedRule', 'reason']);
      expect(call.system).toContain(`están escritos en ${describeLanguage(language)}`);
      // Las reglas editoriales siguen en español (D11).
      expect(call.system).toContain(ANALYST.editorialRules.forbidden[0]);
    });

    // Review de 13.5, M1: fuera de ES se aclara que las reglas valen igual en
    // el idioma del texto, incluidas las de forma ("lo que el texto dice y
    // cómo lo dice"), y que el idioma por sí solo no es una violación. En ES
    // la aclaración no va.
    const RULES_NOTE = 'Las reglas de arriba están redactadas en español';

    it.each(['EN', 'PT'] as const)('editorialReview en %s aclara que las reglas en español se aplican igual, forma incluida', async (language) => {
      mockGenerateObject.mockResolvedValue({ object: { passed: true } });

      await service.editorialReview(CLAIM, ANALYST, 'GOOGLE', 'The whole argument.', language);

      const note = (mockGenerateObject.mock.calls[0][0].system as string).split('\n\n').find((p) => p.startsWith(RULES_NOTE));
      expect(note).toBe(
        `${RULES_NOTE}, pero se aplican igual a un texto en ${describeLanguage(language)}: evalúa lo que el texto dice y cómo lo dice. Que el texto no esté en español no es, por sí solo, una violación.`
      );
    });

    it('editorialReview en ES no lleva la aclaración de las reglas', async () => {
      mockGenerateObject.mockResolvedValue({ object: { passed: true } });

      await service.editorialReview(CLAIM, ANALYST, 'GOOGLE', 'Todo el argumento.', 'ES');

      expect(mockGenerateObject.mock.calls[0][0].system).not.toContain(RULES_NOTE);
    });
  });
});
