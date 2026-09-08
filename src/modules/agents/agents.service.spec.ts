import { Test, TestingModule } from '@nestjs/testing';
import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { ModelProviderFactory } from '../ai/model-provider.factory';
import { LlmRateLimiterService } from '../ai/llm-rate-limiter.service';
import { AgentsService } from './agents.service';
import { DebateContext } from '../../shared/contracts/agents.contracts';
import { ANALYST, JUDGE, buildDebaterSystemPrompt, buildJudgeSystemPrompt } from '../../shared/personas/agents.personas';

// generateObject es el borde real con el AI SDK — se mockea acá (jest-testing
// skill: "mock at the SDK call boundary"), nunca se llama al LLM real.
jest.mock('ai', () => ({
  generateObject: jest.fn(),
}));

const mockGenerateObject = generateObject as jest.Mock;

// Sentinel: no importa qué LanguageModel real sea, solo que sea el mismo
// objeto que devolvió ModelProviderFactory.resolve() — así se verifica el
// wiring sin acoplarse a un provider concreto.
const FAKE_MODEL = { id: 'fake-model' } as unknown as LanguageModel;

function buildContext(overrides: Partial<DebateContext> = {}): DebateContext {
  return {
    topic: 'La IA va a reemplazar a los programadores',
    evidenceBase: {
      topic: 'La IA va a reemplazar a los programadores',
      facts: [{ statement: 'El 40% de las empresas ya usa copilotos de IA', sourceId: '11111111-1111-4111-8111-111111111111' }],
    },
    officialArguments: [],
    ...overrides,
  };
}

describe('AgentsService', () => {
  let service: AgentsService;
  let modelProviderFactory: { resolve: jest.Mock };

  beforeEach(async () => {
    mockGenerateObject.mockReset();
    modelProviderFactory = { resolve: jest.fn().mockReturnValue(FAKE_MODEL) };
    const rateLimiter = { acquire: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: ModelProviderFactory, useValue: modelProviderFactory },
        { provide: LlmRateLimiterService, useValue: rateLimiter },
      ],
    }).compile();

    service = module.get(AgentsService);
  });

  describe('createDebateAgent', () => {
    it('resuelve el modelo a través de ModelProviderFactory con el provider indicado', () => {
      service.createDebateAgent(ANALYST, 'GOOGLE');

      expect(modelProviderFactory.resolve).toHaveBeenCalledWith('GOOGLE');
    });
  });

  describe('DebaterAgent.argue()', () => {
    it('devuelve un ArgumentDraft válido usando el system prompt de la fase OPENING/REBUTTAL', async () => {
      mockGenerateObject.mockResolvedValue({ object: { content: 'La evidencia muestra una adopción creciente.' } });
      const agent = service.createDebateAgent(ANALYST, 'GOOGLE');
      const context = buildContext();

      const draft = await agent.argue(context, 'REBUTTAL');

      expect(draft).toEqual({ content: 'La evidencia muestra una adopción creciente.' });
      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.model).toBe(FAKE_MODEL);
      expect(call.system).toBe(buildDebaterSystemPrompt(ANALYST, 'REBUTTAL'));
      expect(call.prompt).toContain(context.topic);
      expect(call.prompt).toContain(context.evidenceBase.facts[0].statement);
    });
  });

  describe('DebaterAgent.respond()', () => {
    it('devuelve un CrossExaminationDraft apuntando al target recibido', async () => {
      mockGenerateObject.mockResolvedValue({
        object: { content: 'Ese dato no distingue adopción de uso real.', respondsToId: '22222222-2222-4222-8222-222222222222' },
      });
      const agent = service.createDebateAgent(ANALYST, 'GOOGLE');
      const context = buildContext();
      const target = {
        id: '22222222-2222-4222-8222-222222222222',
        agentId: '33333333-3333-4333-8333-333333333333',
        content: 'Los copilotos de IA ya reemplazan tareas enteras.',
        roundType: 'REBUTTAL' as const,
      };

      const draft = await agent.respond(context, target);

      expect(draft.respondsToId).toBe(target.id);
      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.system).toBe(buildDebaterSystemPrompt(ANALYST, 'CROSS_EXAMINATION'));
      expect(call.prompt).toContain(target.content);
      expect(call.prompt).toContain(target.id);
    });
  });

  describe('DebaterAgent.amend()', () => {
    it('re-valida contra ArgumentDraftSchema cuando el original es de OPENING/REBUTTAL', async () => {
      mockGenerateObject.mockResolvedValue({ object: { content: 'Versión corregida sin el dato cuestionado.' } });
      const agent = service.createDebateAgent(ANALYST, 'GOOGLE');
      const context = buildContext();
      const original = { content: 'Versión original con un dato falso.' };
      const feedback = { reason: 'FACTUAL_ERROR' as const, failedClaim: 'un dato falso', details: 'El dato no está respaldado por ninguna fuente.' };

      const amended = await agent.amend(context, original, feedback, 'OPENING');

      expect(amended).toEqual({ content: 'Versión corregida sin el dato cuestionado.' });
      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.system).toBe(buildDebaterSystemPrompt(ANALYST, 'OPENING'));
      expect(call.prompt).toContain(feedback.details);
    });

    it('re-valida contra CrossExaminationDraftSchema cuando el original es de CROSS_EXAMINATION', async () => {
      mockGenerateObject.mockResolvedValue({
        object: { content: 'Respuesta corregida.', respondsToId: '22222222-2222-4222-8222-222222222222' },
      });
      const agent = service.createDebateAgent(ANALYST, 'GOOGLE');
      const context = buildContext();
      const original = { content: 'Respuesta original que rompía la persona.', respondsToId: '22222222-2222-4222-8222-222222222222' };
      const feedback = { reason: 'PERSONA_VIOLATION' as const, details: 'Usó un ataque personal, prohibido para ANALYST.' };

      const amended = await agent.amend(context, original, feedback, 'CROSS_EXAMINATION');

      expect(amended).toEqual({ content: 'Respuesta corregida.', respondsToId: '22222222-2222-4222-8222-222222222222' });
      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.system).toBe(buildDebaterSystemPrompt(ANALYST, 'CROSS_EXAMINATION'));
    });
  });

  describe('AgentsService.judge()', () => {
    it('devuelve un VerdictOutput usando el system prompt del Judge', async () => {
      mockGenerateObject.mockResolvedValue({
        object: { content: 'Ganó Analyst por solidez de evidencia.', winnerAgentId: '33333333-3333-4333-8333-333333333333' },
      });
      const context = buildContext({
        officialArguments: [{ id: '44444444-4444-4444-8444-444444444444', agentId: '33333333-3333-4333-8333-333333333333', content: 'Argumento oficial', roundType: 'OPENING' }],
      });

      const verdict = await service.judge(context, 'ANTHROPIC');

      expect(verdict.winnerAgentId).toBe('33333333-3333-4333-8333-333333333333');
      expect(modelProviderFactory.resolve).toHaveBeenCalledWith('ANTHROPIC');
      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.system).toBe(buildJudgeSystemPrompt(JUDGE));
      expect(call.prompt).toContain(context.topic);
    });
  });

  describe('resiliencia (Cockatiel)', () => {
    it('agota los reintentos y termina rechazando cuando el output nunca matchea el schema (coding-rules.md §3)', async () => {
      // .parse() va DENTRO del bloque reintentado: un output mal formado
      // dispara el mismo retry que un timeout, nunca un valor "recuperado" a mano.
      mockGenerateObject.mockResolvedValue({ object: {} }); // sin `content` — falla ArgumentDraftSchema
      const agent = service.createDebateAgent(ANALYST, 'GOOGLE');

      await expect(agent.argue(buildContext(), 'OPENING')).rejects.toThrow();

      // maxAttempts: 3 en cockatiel = 1 intento inicial + 3 reintentos = 4 invocaciones.
      expect(mockGenerateObject).toHaveBeenCalledTimes(4);
    }, 10_000);
  });
});
