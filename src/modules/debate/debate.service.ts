import { Injectable } from "@nestjs/common";
import { Argument, ArgumentHistoryStatus, ArgumentOrigin, ArgumentStatus, Debate, DebateRound, RoundType, Verdict } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { VerdictOutput } from "../../shared/contracts/agents.contracts";
import { NoCrossExaminationTargetError } from "./debate.errors";

// DebateModule no llama a ningún servicio externo (LLM, búsqueda, TTS) — solo
// persiste el grafo Debate/DebateRound/Argument/ArgumentHistory/Verdict y
// aplica las reglas de negocio sobre esas entidades. Por eso, a diferencia de
// AgentsModule/ResearchModule, no tiene política Cockatiel propia
// (coding-rules.md §4 aplica a integraciones externas, no a Prisma).
//
// EpisodesModule (todavía no existe) es quien orquesta: llama a
// AgentsModule para generar cada draft, a FactCheckModule para validarlo, y
// a este servicio para persistir el resultado de cada paso — DebateModule no
// importa ninguno de esos dos módulos (mismo aislamiento que AgentsModule).
@Injectable()
export class DebateService {
  constructor(private readonly prisma: PrismaService) {}

  async createDebate(topicId: string): Promise<Debate> {
    return this.prisma.debate.create({ data: { topicId } });
  }

  async createRound(debateId: string, round: number, type: RoundType): Promise<DebateRound> {
    return this.prisma.debateRound.create({ data: { debateId, round, type } });
  }

  // status/origin quedan sin setear a propósito: schema.prisma ya los
  // defaultea a DRAFT/AI_GENERATED (Feature 3).
  async createDraftArgument(
    debateRoundId: string,
    agentId: string,
    content: string,
    respondsToId?: string
  ): Promise<Argument> {
    return this.prisma.argument.create({ data: { debateRoundId, agentId, content, respondsToId } });
  }

  async promoteToOfficial(argumentId: string): Promise<Argument> {
    return this.prisma.argument.update({ where: { id: argumentId }, data: { status: ArgumentStatus.OFFICIAL } });
  }

  // Terminal: la llama EpisodesModule cuando procesarBorrador agota
  // maxRevisionAttempts (architecture.md §7.3) — no lo decide este módulo.
  async rejectArgument(argumentId: string): Promise<Argument> {
    return this.prisma.argument.update({ where: { id: argumentId }, data: { status: ArgumentStatus.REJECTED } });
  }

  // Loop de enmienda (architecture.md §7.3): el draft anterior falló
  // fact-check/editorial. Se archiva tal cual estaba (ArgumentHistory con
  // status REJECTED, mismo origin) y se pisa el content con la versión
  // enmendada — el Argument sigue en DRAFT hasta que procesarBorrador lo
  // vuelva a evaluar.
  async reviseDraft(argumentId: string, newContent: string): Promise<Argument> {
    const current = await this.prisma.argument.findUniqueOrThrow({ where: { id: argumentId } });
    await this.prisma.argumentHistory.create({
      data: { argumentId, content: current.content, origin: current.origin, status: ArgumentHistoryStatus.REJECTED },
    });
    return this.prisma.argument.update({ where: { id: argumentId }, data: { content: newContent } });
  }

  // Feature 5 — edición humana post-hoc (no un rechazo por fact-check):
  // archiva la versión anterior (ArgumentHistory con status SUPERSEDED, con
  // SU origin original) y marca el argumento como HUMAN_EDITED.
  async editByHuman(argumentId: string, newContent: string): Promise<Argument> {
    const current = await this.prisma.argument.findUniqueOrThrow({ where: { id: argumentId } });
    await this.prisma.argumentHistory.create({
      data: { argumentId, content: current.content, origin: current.origin, status: ArgumentHistoryStatus.SUPERSEDED },
    });
    return this.prisma.argument.update({
      where: { id: argumentId },
      data: { content: newContent, origin: ArgumentOrigin.HUMAN_EDITED },
    });
  }

  // architecture.md §7.2: elegir al azar un Argument OFFICIAL del oponente
  // que todavía no haya sido target de un cross-examination en este debate —
  // si ya lo fueron todos, no queda otra que repetir uno.
  async pickCrossExaminationTarget(debateId: string, opponentAgentId: string): Promise<Argument> {
    const candidates = await this.prisma.argument.findMany({
      where: { agentId: opponentAgentId, status: ArgumentStatus.OFFICIAL, debateRound: { debateId } },
    });

    if (candidates.length === 0) {
      throw new NoCrossExaminationTargetError(debateId, opponentAgentId);
    }

    const alreadyTargeted = await this.prisma.argument.findMany({
      where: { debateRound: { debateId }, respondsToId: { not: null } },
      select: { respondsToId: true },
    });
    const targetedIds = new Set(alreadyTargeted.map((a) => a.respondsToId));

    const untargeted = candidates.filter((c) => !targetedIds.has(c.id));
    const pool = untargeted.length > 0 ? untargeted : candidates;

    return pool[Math.floor(Math.random() * pool.length)];
  }

  async createVerdict(debateId: string, judgeId: string, verdict: VerdictOutput): Promise<Verdict> {
    return this.prisma.verdict.create({
      data: { debateId, judgeId, content: verdict.content, winnerId: verdict.winnerAgentId },
    });
  }
}
