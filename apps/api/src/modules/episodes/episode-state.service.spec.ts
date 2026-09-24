import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { EpisodeEventsService } from "./episode-events.service";
import { EpisodeStateService } from "./episode-state.service";
import { InvalidEpisodeTransitionError } from "./episodes.errors";

const EPISODE_ID = "11111111-1111-4111-8111-111111111111";
const ROUND_ID = "22222222-2222-4222-8222-222222222222";

function episodeRow(status: string) {
  return { id: EPISODE_ID, status };
}

describe("EpisodeStateService", () => {
  let service: EpisodeStateService;
  let prisma: {
    episode: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    episodeCheckpoint: { findFirst: jest.Mock; findFirstOrThrow: jest.Mock; create: jest.Mock };
    episodeUsage: { findUniqueOrThrow: jest.Mock };
  };
  let notifications: { notify: jest.Mock };
  let events: { emit: jest.Mock };

  beforeEach(async () => {
    prisma = {
      episode: { findUniqueOrThrow: jest.fn(), update: jest.fn() },
      episodeCheckpoint: { findFirst: jest.fn(), findFirstOrThrow: jest.fn(), create: jest.fn() },
      episodeUsage: { findUniqueOrThrow: jest.fn() },
    };
    notifications = { notify: jest.fn() };
    events = { emit: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EpisodeStateService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: EpisodeEventsService, useValue: events },
      ],
    }).compile();

    service = module.get(EpisodeStateService);
  });

  describe("transiciones simples", () => {
    it.each([
      ["markResearching", "CREATED", "RESEARCHING"],
      ["markResearching", "REQUIRES_HUMAN_REVIEW", "RESEARCHING"],
      ["markReadyForDebate", "RESEARCHING", "READY_FOR_DEBATE"],
      ["markDebating", "READY_FOR_DEBATE", "DEBATING"],
      ["markDebating", "REQUIRES_HUMAN_REVIEW", "DEBATING"],
      ["markJudging", "DEBATING", "JUDGING"],
      ["markJudging", "REQUIRES_HUMAN_REVIEW", "JUDGING"],
      ["markApproved", "PENDING_REVIEW", "APPROVED"],
      ["markCancelled", "PENDING_REVIEW", "CANCELLED"],
      ["markCancelled", "REQUIRES_HUMAN_REVIEW", "CANCELLED"],
      ["markGeneratingAudio", "APPROVED", "GENERATING_AUDIO"],
      ["markGeneratingAudio", "REQUIRES_HUMAN_REVIEW", "GENERATING_AUDIO"],
      ["markReadyForRender", "GENERATING_AUDIO", "READY_FOR_RENDER"],
    ] as const)("%s permite la transición desde %s hacia %s", async (method, from, to) => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow(from));
      prisma.episode.update.mockResolvedValue(episodeRow(to));

      await (service[method] as (id: string) => Promise<unknown>)(EPISODE_ID);

      expect(prisma.episode.update).toHaveBeenCalledWith({ where: { id: EPISODE_ID }, data: { status: to } });
    });

    it("markResearching rechaza un estado de origen no permitido", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow("DEBATING"));

      await expect(service.markResearching(EPISODE_ID)).rejects.toThrow(InvalidEpisodeTransitionError);
      expect(prisma.episode.update).not.toHaveBeenCalled();
    });

    it("markApproved y markCancelled no notifican (sin NotificationType para esos casos)", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow("PENDING_REVIEW"));
      prisma.episode.update.mockResolvedValue(episodeRow("APPROVED"));

      await service.markApproved(EPISODE_ID);

      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe("markPendingReview", () => {
    it("transiciona desde JUDGING y notifica EPISODE_PENDING_REVIEW", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow("JUDGING"));
      prisma.episode.update.mockResolvedValue(episodeRow("PENDING_REVIEW"));

      await service.markPendingReview(EPISODE_ID);

      expect(prisma.episode.update).toHaveBeenCalledWith({ where: { id: EPISODE_ID }, data: { status: "PENDING_REVIEW" } });
      expect(notifications.notify).toHaveBeenCalledWith(EPISODE_ID, "EPISODE_PENDING_REVIEW");
      // api-contract.md §4 — evento SSE en vivo, complementario a la Notification
      // persistida (gap encontrado y corregido en revisión: no se emitía).
      expect(events.emit).toHaveBeenCalledWith(EPISODE_ID, "episode.pending_review");
    });
  });

  describe("requireHumanReview", () => {
    it.each(["RESEARCHING", "DEBATING", "JUDGING", "GENERATING_AUDIO"] as const)(
      "desde %s, sin checkpoint previo, crea el checkpoint y transiciona a REQUIRES_HUMAN_REVIEW",
      async (from) => {
        prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow(from));
        prisma.episodeCheckpoint.findFirst.mockResolvedValue(null);
        prisma.episodeUsage.findUniqueOrThrow.mockResolvedValue({ id: "usage-1", episodeId: EPISODE_ID, llmCalls: 3 });
        prisma.episode.update.mockResolvedValue(episodeRow("REQUIRES_HUMAN_REVIEW"));

        await service.requireHumanReview(EPISODE_ID, "INSUFFICIENT_EVIDENCE");

        expect(prisma.episodeCheckpoint.create).toHaveBeenCalledWith({
          data: {
            episodeId: EPISODE_ID,
            fromState: from,
            reason: "INSUFFICIENT_EVIDENCE",
            debateRoundId: undefined,
            snapshot: JSON.stringify({ id: "usage-1", episodeId: EPISODE_ID, llmCalls: 3 }),
          },
        });
        expect(prisma.episode.update).toHaveBeenCalledWith({
          where: { id: EPISODE_ID },
          data: { status: "REQUIRES_HUMAN_REVIEW" },
        });
        expect(notifications.notify).toHaveBeenCalledWith(EPISODE_ID, "EPISODE_REQUIRES_REVIEW", "INSUFFICIENT_EVIDENCE");
        // api-contract.md §4 — evento SSE episode.requires_review con
        // {reason, checkpoint} (gap encontrado y corregido en revisión).
        expect(events.emit).toHaveBeenCalledWith(
          EPISODE_ID,
          "episode.requires_review",
          expect.objectContaining({ reason: "INSUFFICIENT_EVIDENCE" })
        );
      }
    );

    it("rechaza un estado de origen no transversal (ej. PENDING_REVIEW)", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow("PENDING_REVIEW"));

      await expect(service.requireHumanReview(EPISODE_ID, "USAGE_LIMIT_EXCEEDED")).rejects.toThrow(
        InvalidEpisodeTransitionError
      );
    });

    it("propaga debateRoundId al checkpoint cuando se provee", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow("DEBATING"));
      prisma.episodeCheckpoint.findFirst.mockResolvedValue(null);
      prisma.episodeUsage.findUniqueOrThrow.mockResolvedValue({ id: "usage-1" });
      prisma.episode.update.mockResolvedValue(episodeRow("REQUIRES_HUMAN_REVIEW"));

      await service.requireHumanReview(EPISODE_ID, "MAX_REVISIONS_EXCEEDED", ROUND_ID);

      expect(prisma.episodeCheckpoint.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ debateRoundId: ROUND_ID }) })
      );
    });

    it("NO escala a FAILED cuando el reason es distinto al del checkpoint anterior", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow("RESEARCHING"));
      prisma.episodeCheckpoint.findFirst.mockResolvedValue({ reason: "USAGE_LIMIT_EXCEEDED" });
      prisma.episodeUsage.findUniqueOrThrow.mockResolvedValue({ id: "usage-1" });
      prisma.episode.update.mockResolvedValue(episodeRow("REQUIRES_HUMAN_REVIEW"));

      await service.requireHumanReview(EPISODE_ID, "INSUFFICIENT_EVIDENCE");

      expect(prisma.episode.update).toHaveBeenCalledWith({
        where: { id: EPISODE_ID },
        data: { status: "REQUIRES_HUMAN_REVIEW" },
      });
      expect(notifications.notify).toHaveBeenCalledWith(EPISODE_ID, "EPISODE_REQUIRES_REVIEW", "INSUFFICIENT_EVIDENCE");
    });

    it("escala directo a FAILED (sin pasar por REQUIRES_HUMAN_REVIEW) cuando el reason coincide con el checkpoint anterior", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow("RESEARCHING"));
      prisma.episodeCheckpoint.findFirst.mockResolvedValue({ reason: "INSUFFICIENT_EVIDENCE" });
      prisma.episodeUsage.findUniqueOrThrow.mockResolvedValue({ id: "usage-1" });
      prisma.episode.update.mockResolvedValue(episodeRow("FAILED"));

      await service.requireHumanReview(EPISODE_ID, "INSUFFICIENT_EVIDENCE");

      // Un solo checkpoint creado (el de FAILED, dentro de markFailed) — nunca
      // se crea un checkpoint intermedio de REQUIRES_HUMAN_REVIEW acá.
      expect(prisma.episodeCheckpoint.create).toHaveBeenCalledTimes(1);
      expect(prisma.episodeCheckpoint.create).toHaveBeenCalledWith({
        data: {
          episodeId: EPISODE_ID,
          fromState: "RESEARCHING",
          reason: "INSUFFICIENT_EVIDENCE",
          debateRoundId: undefined,
          snapshot: JSON.stringify({ id: "usage-1" }),
        },
      });
      expect(prisma.episode.update).toHaveBeenCalledWith({ where: { id: EPISODE_ID }, data: { status: "FAILED" } });
      expect(notifications.notify).toHaveBeenCalledWith(EPISODE_ID, "EPISODE_FAILED", "INSUFFICIENT_EVIDENCE");
      expect(notifications.notify).not.toHaveBeenCalledWith(EPISODE_ID, "EPISODE_REQUIRES_REVIEW", expect.anything());
    });
  });

  describe("markFailed", () => {
    it("crea checkpoint final y notifica EPISODE_FAILED, válido desde REQUIRES_HUMAN_REVIEW", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow("REQUIRES_HUMAN_REVIEW"));
      prisma.episodeUsage.findUniqueOrThrow.mockResolvedValue({ id: "usage-1" });
      prisma.episode.update.mockResolvedValue(episodeRow("FAILED"));

      await service.markFailed(EPISODE_ID, "MAX_REVISIONS_EXCEEDED");

      expect(prisma.episode.update).toHaveBeenCalledWith({ where: { id: EPISODE_ID }, data: { status: "FAILED" } });
      expect(notifications.notify).toHaveBeenCalledWith(EPISODE_ID, "EPISODE_FAILED", "MAX_REVISIONS_EXCEEDED");
    });

    it("rechaza un estado de origen no permitido (ej. CREATED)", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow("CREATED"));

      await expect(service.markFailed(EPISODE_ID, "USAGE_LIMIT_EXCEEDED")).rejects.toThrow(
        InvalidEpisodeTransitionError
      );
    });
  });

  describe("resumeFromCheckpoint", () => {
    it("restaura exactamente el fromState del checkpoint más reciente", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow("REQUIRES_HUMAN_REVIEW"));
      prisma.episodeCheckpoint.findFirstOrThrow.mockResolvedValue({ fromState: "DEBATING" });
      prisma.episode.update.mockResolvedValue(episodeRow("DEBATING"));

      await service.resumeFromCheckpoint(EPISODE_ID);

      expect(prisma.episode.update).toHaveBeenCalledWith({ where: { id: EPISODE_ID }, data: { status: "DEBATING" } });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it("rechaza si el episodio no está en REQUIRES_HUMAN_REVIEW", async () => {
      prisma.episode.findUniqueOrThrow.mockResolvedValue(episodeRow("DEBATING"));

      await expect(service.resumeFromCheckpoint(EPISODE_ID)).rejects.toThrow(InvalidEpisodeTransitionError);
    });
  });
});
