import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { DebateContext } from "../../shared/contracts/agents.contracts";
import { DEBATER_PERSONAS, DebaterPersona } from "../../shared/personas/agents.personas";

// Spec 004, paso 5a (tasks.md §13.5): única fuente del DebateContext que
// reciben los agentes. Reemplaza las dos copias de buildDebateContext que
// tenían EpisodeOrchestratorService y EpisodeActionsService; con dos copias,
// sumar un campo en una sola (el idioma de la spec 004) hacía que
// `regenerate` saliera distinto del pipeline sin que fallara ningún test del
// orquestador. Extraído sin cambio de comportamiento: mismas queries y mismo
// shape que las dos copias.
//
// Se reconstruye en cada llamada (no se cachea): officialArguments crece con
// cada Argument promovido a OFFICIAL dentro de la misma corrida del pipeline.
//
// Paso 5c: suma language desde Episode.language. Como todos los caminos que
// retoman el pipeline (resume, recovery, regenerate, regenerate-verdict)
// pasan por acá, el idioma sobrevive a cualquier corte (AC 4.10-4.12).
@Injectable()
export class EpisodeContextService {
  constructor(private readonly prisma: PrismaService) {}

  async build(episodeId: string): Promise<DebateContext> {
    const episode = await this.prisma.episode.findUniqueOrThrow({
      where: { id: episodeId },
      select: {
        debateId: true,
        language: true,
        debate: { select: { topicId: true, topic: { select: { title: true } } } },
      },
    });
    const topicId = episode.debate.topicId;
    const topicTitle = episode.debate.topic.title;

    const facts = await this.prisma.evidenceFact.findMany({
      where: { source: { researchSession: { topicId } } },
    });
    const officialArgs = await this.prisma.argument.findMany({
      where: { debateRound: { debateId: episode.debateId }, status: "OFFICIAL" },
      include: { debateRound: true },
      orderBy: { createdAt: "asc" },
    });
    // El juez no entra: nunca es autor de un Argument (architecture.md §7.1:
    // solo los 2 debatientes generan Argument), así que no hace falta para
    // la transcripción ni para identificar al oponente.
    const debaterParticipants = await this.prisma.episodeParticipant.findMany({
      where: { episodeId, isJudge: false },
      include: { agent: true },
    });

    return {
      topic: topicTitle,
      evidenceBase: {
        topic: topicTitle,
        facts: facts.map((f) => ({ statement: f.content, sourceId: f.sourceId })),
      },
      officialArguments: officialArgs.map((a) => ({
        id: a.id,
        agentId: a.agentId,
        content: a.content,
        roundType: a.debateRound.type,
      })),
      participants: debaterParticipants.map((p) => {
        const persona = DEBATER_PERSONAS[p.agent.role as DebaterPersona["id"]];
        return { agentId: p.agentId, personaId: persona.id, displayName: persona.displayName };
      }),
      language: episode.language,
    };
  }
}
