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
    return this.replaceContent(argumentId, { content: newContent }, ArgumentHistoryStatus.REJECTED);
  }

  // Acción `regenerate` del curador (EpisodeActionsService): mismo archivo
  // que reviseDraft (REJECTED, origin previo), pero el argumento queda
  // OFFICIAL en el mismo update. Si se regenera uno que no era OFFICIAL
  // (findArgumentInEpisode no filtra status), el juez no lo ve hasta la
  // promoción: con reviseDraft + promoteToOfficial por separado, un
  // judgedFrom entre el historial y el promote daba stale: false sin que
  // el juez lo hubiera leído (review F2-2).
  async regenerateArgument(argumentId: string, newContent: string): Promise<Argument> {
    return this.replaceContent(
      argumentId,
      { content: newContent, status: ArgumentStatus.OFFICIAL },
      ArgumentHistoryStatus.REJECTED
    );
  }

  // Feature 5 — edición humana post-hoc (no un rechazo por fact-check):
  // archiva la versión anterior (ArgumentHistory con status SUPERSEDED, con
  // SU origin original) y marca el argumento como HUMAN_EDITED.
  async editByHuman(argumentId: string, newContent: string): Promise<Argument> {
    return this.replaceContent(
      argumentId,
      { content: newContent, origin: ArgumentOrigin.HUMAN_EDITED },
      ArgumentHistoryStatus.SUPERSEDED
    );
  }

  // Orden a propósito (review F2-2, entrada 35): primero se pisa el
  // Argument (content y, si corresponde, status/origin) y DESPUÉS se archiva
  // la versión previa, ya leída. El historial nace cuando lo nuevo ya es
  // visible, así que si el juez de regenerate-verdict leyó la versión
  // vieja, su judgedFrom (tomado antes de leer) es ≤ createdAt del
  // historial e isVerdictStale (gte) lo marca. Con el orden inverso quedaba
  // una ventana entre las dos escrituras en la que el juez leía lo viejo
  // con judgedFrom > createdAt: stale: false.
  //
  // Transacción para no dejar un content nuevo sin su versión previa
  // archivada si falla el create. Callback mínimo, como replaceVerdict:
  // atomicidad sin aislamiento (coding-rules.md §2).
  private async replaceContent(
    argumentId: string,
    data: { content: string; status?: ArgumentStatus; origin?: ArgumentOrigin },
    archivedAs: ArgumentHistoryStatus
  ): Promise<Argument> {
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.argument.findUniqueOrThrow({ where: { id: argumentId } });
      const updated = await tx.argument.update({ where: { id: argumentId }, data });
      await tx.argumentHistory.create({
        data: { argumentId, content: previous.content, origin: previous.origin, status: archivedAs },
      });
      return updated;
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

  // Spec 003, API-19 (D17): "Volver a juzgar". Verdict sigue siendo 1:1 con
  // Debate (debateId @unique), así que el reemplazo archiva el vigente en
  // VerdictHistory, lo borra y crea el nuevo, todo en una transacción: si
  // algo falla, el veredicto anterior queda intacto y no queda un archivo
  // huérfano. Verdict.id cambia en cada vuelta. Sin veredicto vigente
  // (no debería pasar: la acción solo es válida en PENDING_REVIEW, después
  // de JUDGING), crea el nuevo sin archivar nada.
  //
  // `judgedFrom` es el createdAt del veredicto nuevo: el momento del debate
  // que evaluó el juez (antes de leer su contexto), no el de la escritura.
  // Así isVerdictStale marca las ediciones hechas mientras el juez corría.
  //
  // Callback mínimo a propósito (review F2-2): con
  // @prisma/adapter-better-sqlite3 hay una sola conexión, así que la
  // transacción da atomicidad pero no aislamiento: las queries de otras
  // requests que caen entre estos await corren dentro de ella (y un rollback
  // se las lleva). Nada lento acá adentro (coding-rules.md §2).
  async replaceVerdict(debateId: string, judgeId: string, output: VerdictOutput, judgedFrom: Date): Promise<Verdict> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.verdict.findUnique({ where: { debateId } });
      if (current) {
        await tx.verdictHistory.create({
          data: {
            debateId,
            judgeId: current.judgeId,
            content: current.content,
            winnerId: current.winnerId,
            issuedAt: current.createdAt,
          },
        });
        await tx.verdict.delete({ where: { id: current.id } });
      }
      return tx.verdict.create({
        data: { debateId, judgeId, content: output.content, winnerId: output.winnerAgentId, createdAt: judgedFrom },
      });
    });
  }

  // API-19: el veredicto está desactualizado si algún argumento del debate
  // se archivó en ArgumentHistory a partir del momento que evaluó el juez
  // (Verdict.createdAt; edit y regenerate siempre archivan la versión
  // previa). Sin columna nueva. `gte`, no `gt` (review F2-2): un empate en
  // el mismo milisegundo cae del lado seguro. El historial del loop de
  // enmienda es anterior al veredicto (JUDGING va después de DEBATING).
  // Que reviseDraft/regenerateArgument/editByHuman archiven DESPUÉS de
  // pisar el Argument (replaceContent) es lo que garantiza que un juez que
  // leyó la versión vieja no quede sin marcar.
  async isVerdictStale(debateId: string, verdictCreatedAt: Date): Promise<boolean> {
    const newer = await this.prisma.argumentHistory.count({
      where: { createdAt: { gte: verdictCreatedAt }, argument: { debateRound: { debateId } } },
    });
    return newer > 0;
  }
}
