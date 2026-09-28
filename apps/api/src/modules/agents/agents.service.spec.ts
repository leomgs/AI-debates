import { Test, TestingModule } from '@nestjs/testing';
import { generateObject } from 'ai';
import type { LanguageModel } from 'ai';
import { ModelProviderFactory } from '../ai/model-provider.factory';
import { LlmRateLimiterService } from '../ai/llm-rate-limiter.service';
import { AgentsService } from './agents.service';
import { DebateContext } from '../../shared/contracts/agents.contracts';
import { ANALYST, CONTRARIAN, JUDGE, buildDebaterSystemPrompt, buildJudgeSystemPrompt } from '../../shared/personas/agents.personas';
import { buildLanguageInstruction } from '../../shared/personas/language-instruction';

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
    participants: [],
    language: 'ES',
    ...overrides,
  };
}

const AGENT_A_ID = '55555555-5555-4555-8555-555555555555';
const AGENT_B_ID = '66666666-6666-4666-8666-666666666666';

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
      expect(call.system).toBe(buildDebaterSystemPrompt(ANALYST, 'REBUTTAL', 'ES'));
      expect(call.prompt).toContain(context.topic);
      expect(call.prompt).toContain(context.evidenceBase.facts[0].statement);
    });

    it('identifica al oponente en el system prompt cuando context.participants trae 2 personas', async () => {
      mockGenerateObject.mockResolvedValue({ object: { content: 'La evidencia muestra una adopción creciente.' } });
      const agent = service.createDebateAgent(ANALYST, 'GOOGLE');
      const context = buildContext({
        participants: [
          { agentId: AGENT_A_ID, personaId: ANALYST.id, displayName: ANALYST.displayName },
          { agentId: AGENT_B_ID, personaId: CONTRARIAN.id, displayName: CONTRARIAN.displayName },
        ],
      });

      await agent.argue(context, 'REBUTTAL');

      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.system).toBe(buildDebaterSystemPrompt(ANALYST, 'REBUTTAL', 'ES', CONTRARIAN));
      expect(call.system).toContain(CONTRARIAN.displayName);
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
      expect(call.system).toBe(buildDebaterSystemPrompt(ANALYST, 'CROSS_EXAMINATION', 'ES'));
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
      expect(call.system).toBe(buildDebaterSystemPrompt(ANALYST, 'OPENING', 'ES'));
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
      expect(call.system).toBe(buildDebaterSystemPrompt(ANALYST, 'CROSS_EXAMINATION', 'ES'));
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
      expect(call.system).toBe(buildJudgeSystemPrompt(JUDGE, 'ES'));
      expect(call.prompt).toContain(context.topic);
    });
  });

  // Spec 004, D11 (AC 4.6): toda llamada generativa lleva la instrucción de
  // idioma del episodio (context.language) como regla del system prompt y
  // como última línea del prompt de usuario. El regenerate de curaduría usa
  // estos mismos argue()/respond() con el contexto compartido
  // (EpisodeContextService), y el regenerate-verdict usa judge().
  describe('instrucción de idioma (spec 004, AC 4.6)', () => {
    const LANGUAGES = ['ES', 'EN', 'PT'] as const;
    const TARGET = {
      id: '22222222-2222-4222-8222-222222222222',
      agentId: AGENT_B_ID,
      content: 'Los copilotos de IA ya reemplazan tareas enteras.',
      roundType: 'REBUTTAL' as const,
    };

    function expectLanguageInstruction(call: { system: string; prompt: string }, language: (typeof LANGUAGES)[number]) {
      const instruction = buildLanguageInstruction(language);
      // Regla del system prompt: su último párrafo.
      expect(call.system.split('\n\n').at(-1)).toBe(instruction);
      // Última línea del prompt de usuario.
      expect(call.prompt.split('\n\n').at(-1)).toBe(instruction);
      // Y ninguna instrucción de otro idioma se cuela.
      for (const other of LANGUAGES.filter((l) => l !== language)) {
        expect(call.system).not.toContain(buildLanguageInstruction(other));
        expect(call.prompt).not.toContain(buildLanguageInstruction(other));
      }
    }

    it.each(LANGUAGES)('argue() en %s', async (language) => {
      mockGenerateObject.mockResolvedValue({ object: { content: 'Un argumento.' } });
      const agent = service.createDebateAgent(ANALYST, 'GOOGLE');

      await agent.argue(buildContext({ language }), 'OPENING');

      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.system).toBe(buildDebaterSystemPrompt(ANALYST, 'OPENING', language));
      expectLanguageInstruction(call, language);
    });

    it.each(LANGUAGES)('respond() en %s', async (language) => {
      mockGenerateObject.mockResolvedValue({ object: { content: 'Una réplica.', respondsToId: TARGET.id } });
      const agent = service.createDebateAgent(ANALYST, 'GOOGLE');

      await agent.respond(buildContext({ language }), TARGET);

      expectLanguageInstruction(mockGenerateObject.mock.calls[0][0], language);
    });

    it.each(LANGUAGES)('amend() en %s, también con respondsToId (la instrucción queda última)', async (language) => {
      mockGenerateObject.mockResolvedValue({ object: { content: 'Enmendado.', respondsToId: TARGET.id } });
      const agent = service.createDebateAgent(ANALYST, 'GOOGLE');
      const feedback = { reason: 'PERSONA_VIOLATION' as const, details: 'Detalle del rechazo.' };

      await agent.amend(buildContext({ language }), { content: 'Original.', respondsToId: TARGET.id }, feedback, 'CROSS_EXAMINATION');

      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.prompt).toContain(`respondsToId: ${TARGET.id}`);
      expectLanguageInstruction(call, language);
    });

    it.each(LANGUAGES)('judge() en %s', async (language) => {
      mockGenerateObject.mockResolvedValue({ object: { content: 'Veredicto.', winnerAgentId: null } });

      await service.judge(buildContext({ language }), 'GOOGLE');

      const call = mockGenerateObject.mock.calls[0][0];
      expect(call.system).toBe(buildJudgeSystemPrompt(JUDGE, language));
      expectLanguageInstruction(call, language);
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
