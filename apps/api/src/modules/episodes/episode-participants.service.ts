import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ModelProvider } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import type { Env } from "../../shared/config/env.schema";
import { DEBATER_PERSONAS, JUDGE } from "../../shared/personas/agents.personas";

// architecture.md §7.1 — selección de participantes al crear el episodio
// (transición CREATED -> RESEARCHING). Solo 2 de las 4 personas debaten por
// episodio, con el Judge como tercer participante fijo (personaje), pero con
// un ModelProvider que rota.
@Injectable()
export class EpisodeParticipantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>
  ) {}

  async selectParticipants(episodeId: string, _debateId: string): Promise<void> {
    const providers = this.getAvailableProviders();
    const [personaA, personaB] = this.pickTwoDistinct(Object.values(DEBATER_PERSONAS));
    const providerA = this.pickRandom(providers);
    const providerB = this.pickRandom(providers);
    const judgeProvider = this.pickJudgeProvider(providers, [providerA, providerB]);

    const [agentA, agentB, judgeAgent] = await Promise.all([
      this.prisma.agent.findFirstOrThrow({ where: { role: personaA.id } }),
      this.prisma.agent.findFirstOrThrow({ where: { role: personaB.id } }),
      this.prisma.agent.findFirstOrThrow({ where: { role: JUDGE.id } }),
    ]);

    await this.prisma.episodeParticipant.createMany({
      data: [
        { episodeId, agentId: agentA.id, modelProvider: providerA, isJudge: false },
        { episodeId, agentId: agentB.id, modelProvider: providerB, isJudge: false },
        { episodeId, agentId: judgeAgent.id, modelProvider: judgeProvider, isJudge: true },
      ],
    });
  }

  // Spec 004, D15: los 5 agentes que selectParticipants puede elegir (los 4
  // roles de DEBATER_PERSONAS más JUDGE), resueltos por role. Al crear el
  // episodio todavía no se sabe cuáles 2 debatientes se van a sortear, así
  // que createEpisode valida las voces de todos. agentId null = no hay fila
  // Agent para ese rol (con findFirstOrThrow, selectParticipants fallaría
  // más tarde). Una sola consulta; por rol se toma la primera fila en el
  // orden por defecto de la base, el mismo criterio que el findFirst sin
  // orderBy de selectParticipants.
  async findCandidateAgents(): Promise<Array<{ role: string; agentId: string | null }>> {
    const roles = [...Object.values(DEBATER_PERSONAS).map((p) => p.id), JUDGE.id];
    const agents = await this.prisma.agent.findMany({ where: { role: { in: roles } }, select: { id: true, role: true } });
    return roles.map((role) => ({ role, agentId: agents.find((a) => a.role === role)?.id ?? null }));
  }

  // No se toca ModelProviderFactory (fuera de scope, ya implementado) — chequeo
  // propio de presencia de env vars. GOOGLE es la única requerida
  // (env.schema.ts), siempre disponible; las otras 3 son opcionales.
  private getAvailableProviders(): ModelProvider[] {
    const providers: ModelProvider[] = ["GOOGLE"];
    if (this.config.get("OPENAI_API_KEY", { infer: true })) providers.push("OPENAI");
    if (this.config.get("ANTHROPIC_API_KEY", { infer: true })) providers.push("ANTHROPIC");
    if (this.config.get("XAI_API_KEY", { infer: true })) providers.push("XAI");
    if (this.config.get("OPENROUTER_API_KEY", { infer: true })) providers.push("OPENROUTER");
    return providers;
  }

  // Preferir un provider distinto al de ambos debatientes (evita que el mismo
  // modelo debata y juzgue en el mismo episodio). Fallback documentado: con
  // el deployment real de hoy (solo GOOGLE configurado), no hay ningún
  // provider "libre" — el Judge cae a sortear entre todos los disponibles
  // igual, puede coincidir con el de un debatiente.
  private pickJudgeProvider(available: ModelProvider[], excluded: ModelProvider[]): ModelProvider {
    const free = available.filter((p) => !excluded.includes(p));
    return free.length > 0 ? this.pickRandom(free) : this.pickRandom(available);
  }

  // Dos llamadas a Math.random (índice del primero, índice del segundo sobre
  // el resto) en vez de un shuffle completo — determinístico de mockear en
  // tests (valores conocidos y en orden fijo), a diferencia de un
  // `.sort(() => Math.random() - 0.5)` cuyo número de invocaciones depende
  // del algoritmo de sort del engine.
  private pickTwoDistinct<T>(items: T[]): [T, T] {
    const firstIndex = this.randomIndex(items.length);
    const first = items[firstIndex];
    const rest = items.filter((_, i) => i !== firstIndex);
    const second = rest[this.randomIndex(rest.length)];
    return [first, second];
  }

  private pickRandom<T>(items: T[]): T {
    return items[this.randomIndex(items.length)];
  }

  private randomIndex(max: number): number {
    return Math.floor(Math.random() * max);
  }
}
