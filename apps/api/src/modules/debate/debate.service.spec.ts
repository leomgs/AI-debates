import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DebateService } from './debate.service';
import { NoCrossExaminationTargetError } from './debate.errors';

const DEBATE_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_A = '22222222-2222-4222-8222-222222222222';
const AGENT_B = '33333333-3333-4333-8333-333333333333';
const ARG_1 = '44444444-4444-4444-8444-444444444444';
const ARG_2 = '55555555-5555-4555-8555-555555555555';

function argumentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: ARG_1,
    debateRoundId: 'round-1',
    agentId: AGENT_A,
    content: 'contenido original',
    status: 'DRAFT',
    origin: 'AI_GENERATED',
    respondsToId: null,
    ...overrides,
  };
}

describe('DebateService', () => {
  let service: DebateService;
  let prisma: {
    debate: { create: jest.Mock };
    debateRound: { create: jest.Mock };
    argument: { create: jest.Mock; update: jest.Mock; findUniqueOrThrow: jest.Mock; findMany: jest.Mock };
    argumentHistory: { create: jest.Mock; count: jest.Mock };
    verdict: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  // Cliente de la transacción interactiva de replaceVerdict (API-19).
  let tx: {
    verdict: { findUnique: jest.Mock; delete: jest.Mock; create: jest.Mock };
    verdictHistory: { create: jest.Mock };
  };

  beforeEach(async () => {
    tx = {
      verdict: { findUnique: jest.fn(), delete: jest.fn(), create: jest.fn() },
      verdictHistory: { create: jest.fn() },
    };
    prisma = {
      debate: { create: jest.fn() },
      debateRound: { create: jest.fn() },
      argument: { create: jest.fn(), update: jest.fn(), findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
      argumentHistory: { create: jest.fn(), count: jest.fn() },
      verdict: { create: jest.fn() },
      $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DebateService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(DebateService);
  });

  it('createDebate persiste un Debate ligado al topicId', async () => {
    prisma.debate.create.mockResolvedValue({ id: DEBATE_ID, topicId: 'topic-1' });

    await service.createDebate('topic-1');

    expect(prisma.debate.create).toHaveBeenCalledWith({ data: { topicId: 'topic-1' } });
  });

  it('createRound persiste un DebateRound tipado por RoundType', async () => {
    prisma.debateRound.create.mockResolvedValue({ id: 'round-1', debateId: DEBATE_ID, round: 1, type: 'OPENING' });

    await service.createRound(DEBATE_ID, 1, 'OPENING');

    expect(prisma.debateRound.create).toHaveBeenCalledWith({ data: { debateId: DEBATE_ID, round: 1, type: 'OPENING' } });
  });

  it('createDraftArgument no fuerza status/origin, deja que schema.prisma aplique los defaults', async () => {
    prisma.argument.create.mockResolvedValue(argumentRow());

    await service.createDraftArgument('round-1', AGENT_A, 'contenido');

    const call = prisma.argument.create.mock.calls[0][0];
    expect(call.data).toEqual({ debateRoundId: 'round-1', agentId: AGENT_A, content: 'contenido', respondsToId: undefined });
  });

  it('promoteToOfficial actualiza el status a OFFICIAL', async () => {
    prisma.argument.update.mockResolvedValue(argumentRow({ status: 'OFFICIAL' }));

    await service.promoteToOfficial(ARG_1);

    expect(prisma.argument.update).toHaveBeenCalledWith({ where: { id: ARG_1 }, data: { status: 'OFFICIAL' } });
  });

  it('rejectArgument actualiza el status a REJECTED', async () => {
    prisma.argument.update.mockResolvedValue(argumentRow({ status: 'REJECTED' }));

    await service.rejectArgument(ARG_1);

    expect(prisma.argument.update).toHaveBeenCalledWith({ where: { id: ARG_1 }, data: { status: 'REJECTED' } });
  });

  describe('reviseDraft (loop de enmienda, architecture.md §7.3)', () => {
    it('archiva el content anterior en ArgumentHistory con status REJECTED antes de pisarlo', async () => {
      prisma.argument.findUniqueOrThrow.mockResolvedValue(argumentRow({ content: 'versión rechazada por fact-check' }));
      prisma.argument.update.mockResolvedValue(argumentRow({ content: 'versión enmendada' }));

      await service.reviseDraft(ARG_1, 'versión enmendada');

      expect(prisma.argumentHistory.create).toHaveBeenCalledWith({
        data: { argumentId: ARG_1, content: 'versión rechazada por fact-check', origin: 'AI_GENERATED', status: 'REJECTED' },
      });
      expect(prisma.argument.update).toHaveBeenCalledWith({ where: { id: ARG_1 }, data: { content: 'versión enmendada' } });
    });
  });

  describe('editByHuman (Feature 5, trazabilidad de mutación)', () => {
    it('archiva la versión anterior con status SUPERSEDED y marca el argumento como HUMAN_EDITED', async () => {
      prisma.argument.findUniqueOrThrow.mockResolvedValue(argumentRow({ content: 'versión IA original', origin: 'AI_GENERATED' }));
      prisma.argument.update.mockResolvedValue(argumentRow({ content: 'versión editada a mano', origin: 'HUMAN_EDITED' }));

      await service.editByHuman(ARG_1, 'versión editada a mano');

      expect(prisma.argumentHistory.create).toHaveBeenCalledWith({
        data: { argumentId: ARG_1, content: 'versión IA original', origin: 'AI_GENERATED', status: 'SUPERSEDED' },
      });
      expect(prisma.argument.update).toHaveBeenCalledWith({
        where: { id: ARG_1 },
        data: { content: 'versión editada a mano', origin: 'HUMAN_EDITED' },
      });
    });
  });

  describe('pickCrossExaminationTarget (architecture.md §7.2)', () => {
    it('tira NoCrossExaminationTargetError si el oponente no tiene ningún Argument OFFICIAL en el debate', async () => {
      prisma.argument.findMany.mockResolvedValueOnce([]); // candidates

      await expect(service.pickCrossExaminationTarget(DEBATE_ID, AGENT_B)).rejects.toThrow(NoCrossExaminationTargetError);
    });

    it('elige entre los OFFICIAL todavía no targeteados cuando hay alguno disponible', async () => {
      prisma.argument.findMany
        .mockResolvedValueOnce([argumentRow({ id: ARG_1 }), argumentRow({ id: ARG_2 })]) // candidates
        .mockResolvedValueOnce([{ respondsToId: ARG_1 }]); // ya targeteados: solo ARG_1

      const target = await service.pickCrossExaminationTarget(DEBATE_ID, AGENT_B);

      expect(target.id).toBe(ARG_2); // el único no targeteado
    });

    it('repite un target ya usado si todos los OFFICIAL ya fueron targeteados', async () => {
      prisma.argument.findMany
        .mockResolvedValueOnce([argumentRow({ id: ARG_1 })]) // candidates: uno solo
        .mockResolvedValueOnce([{ respondsToId: ARG_1 }]); // ya targeteado

      const target = await service.pickCrossExaminationTarget(DEBATE_ID, AGENT_B);

      expect(target.id).toBe(ARG_1); // no queda otra que repetir
    });
  });

  it('createVerdict mapea winnerAgentId del VerdictOutput a winnerId de Prisma', async () => {
    prisma.verdict.create.mockResolvedValue({ id: 'verdict-1' });

    await service.createVerdict(DEBATE_ID, AGENT_A, { content: 'Ganó por solidez de evidencia', winnerAgentId: AGENT_A });

    expect(prisma.verdict.create).toHaveBeenCalledWith({
      data: { debateId: DEBATE_ID, judgeId: AGENT_A, content: 'Ganó por solidez de evidencia', winnerId: AGENT_A },
    });
  });

  // Spec 003, API-19 (D17). El comportamiento transaccional real (rollback
  // incluido) contra SQLite está en episodes.integration.spec.ts.
  describe('replaceVerdict', () => {
    const JUDGE = '66666666-6666-4666-8666-666666666666';
    const issuedAt = new Date('2026-09-25T10:00:00.000Z');
    const judgedFrom = new Date('2026-09-26T09:58:30.000Z');
    const current = { id: 'verdict-old', debateId: DEBATE_ID, judgeId: JUDGE, content: 'Ganó A.', winnerId: AGENT_A, createdAt: issuedAt };

    it('dentro de una transacción archiva el vigente en VerdictHistory, lo borra y crea el nuevo', async () => {
      tx.verdict.findUnique.mockResolvedValue(current);
      tx.verdict.create.mockResolvedValue({ id: 'verdict-new' });

      const result = await service.replaceVerdict(DEBATE_ID, JUDGE, { content: 'Ganó B.', winnerAgentId: AGENT_B }, judgedFrom);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.verdict.findUnique).toHaveBeenCalledWith({ where: { debateId: DEBATE_ID } });
      expect(tx.verdictHistory.create).toHaveBeenCalledWith({
        data: { debateId: DEBATE_ID, judgeId: JUDGE, content: 'Ganó A.', winnerId: AGENT_A, issuedAt },
      });
      expect(tx.verdict.delete).toHaveBeenCalledWith({ where: { id: 'verdict-old' } });
      // createdAt = el momento del debate que evaluó el juez (review F2-2).
      expect(tx.verdict.create).toHaveBeenCalledWith({
        data: { debateId: DEBATE_ID, judgeId: JUDGE, content: 'Ganó B.', winnerId: AGENT_B, createdAt: judgedFrom },
      });
      // Orden: archivar y borrar antes de crear (debateId es @unique en Verdict).
      expect(tx.verdictHistory.create.mock.invocationCallOrder[0]).toBeLessThan(tx.verdict.delete.mock.invocationCallOrder[0]);
      expect(tx.verdict.delete.mock.invocationCallOrder[0]).toBeLessThan(tx.verdict.create.mock.invocationCallOrder[0]);
      expect(result).toEqual({ id: 'verdict-new' });
      // Nada fuera de la transacción.
      expect(prisma.verdict.create).not.toHaveBeenCalled();
    });

    it('sin veredicto vigente crea el nuevo sin archivar nada', async () => {
      tx.verdict.findUnique.mockResolvedValue(null);
      tx.verdict.create.mockResolvedValue({ id: 'verdict-new' });

      await service.replaceVerdict(DEBATE_ID, JUDGE, { content: 'Ganó B.', winnerAgentId: null }, judgedFrom);

      expect(tx.verdictHistory.create).not.toHaveBeenCalled();
      expect(tx.verdict.delete).not.toHaveBeenCalled();
      expect(tx.verdict.create).toHaveBeenCalledWith({
        data: { debateId: DEBATE_ID, judgeId: JUDGE, content: 'Ganó B.', winnerId: null, createdAt: judgedFrom },
      });
    });

    it('si falla un paso, el error se propaga (la transacción no se confirma)', async () => {
      tx.verdict.findUnique.mockResolvedValue(current);
      tx.verdict.create.mockRejectedValue(new Error('FK'));

      await expect(service.replaceVerdict(DEBATE_ID, JUDGE, { content: 'x', winnerAgentId: null }, judgedFrom)).rejects.toThrow('FK');
    });
  });

  describe('isVerdictStale', () => {
    const verdictCreatedAt = new Date('2026-09-25T10:00:00.000Z');

    it('cuenta el ArgumentHistory del debate desde el momento del veredicto, empate incluido (gte)', async () => {
      prisma.argumentHistory.count.mockResolvedValue(1);

      await expect(service.isVerdictStale(DEBATE_ID, verdictCreatedAt)).resolves.toBe(true);
      expect(prisma.argumentHistory.count).toHaveBeenCalledWith({
        where: { createdAt: { gte: verdictCreatedAt }, argument: { debateRound: { debateId: DEBATE_ID } } },
      });
    });

    it('sin historial posterior (por ejemplo, solo el del loop de enmienda) no está desactualizado', async () => {
      prisma.argumentHistory.count.mockResolvedValue(0);

      await expect(service.isVerdictStale(DEBATE_ID, verdictCreatedAt)).resolves.toBe(false);
    });
  });
});
