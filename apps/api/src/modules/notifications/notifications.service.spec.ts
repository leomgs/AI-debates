import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { NotificationsService } from "./notifications.service";

const EPISODE_ID = "11111111-1111-4111-8111-111111111111";
const NOTIFICATION_ID = "22222222-2222-4222-8222-222222222222";

describe("NotificationsService", () => {
  let service: NotificationsService;
  let prisma: {
    notification: { create: jest.Mock; findMany: jest.Mock; update: jest.Mock; updateMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      notification: { create: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe("notify", () => {
    it("arma un mensaje legible con el contextDetail para EPISODE_REQUIRES_REVIEW", async () => {
      prisma.notification.create.mockResolvedValue({ id: NOTIFICATION_ID });

      await service.notify(EPISODE_ID, "EPISODE_REQUIRES_REVIEW", "INSUFFICIENT_EVIDENCE");

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: {
          episodeId: EPISODE_ID,
          type: "EPISODE_REQUIRES_REVIEW",
          message: "El episodio requiere revisión: INSUFFICIENT_EVIDENCE.",
        },
      });
    });

    it("arma un mensaje fijo para EPISODE_PENDING_REVIEW, sin contextDetail", async () => {
      prisma.notification.create.mockResolvedValue({ id: NOTIFICATION_ID });

      await service.notify(EPISODE_ID, "EPISODE_PENDING_REVIEW");

      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: { episodeId: EPISODE_ID, type: "EPISODE_PENDING_REVIEW", message: "El episodio está listo para revisión." },
      });
    });
  });

  describe("list", () => {
    it("filtra por readAt: null cuando unreadOnly es true", async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      await service.list(true);

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: { readAt: null },
        orderBy: { createdAt: "desc" },
      });
    });

    it("no filtra por readAt cuando unreadOnly es false", async () => {
      prisma.notification.findMany.mockResolvedValue([]);

      await service.list(false);

      expect(prisma.notification.findMany).toHaveBeenCalledWith({
        where: undefined,
        orderBy: { createdAt: "desc" },
      });
    });
  });

  it("markRead setea readAt a la fecha actual", async () => {
    prisma.notification.update.mockResolvedValue({ id: NOTIFICATION_ID, readAt: new Date() });

    await service.markRead(NOTIFICATION_ID);

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: NOTIFICATION_ID },
      data: { readAt: expect.any(Date) },
    });
  });

  it("markAllRead actualiza todas las no leídas de una", async () => {
    prisma.notification.updateMany.mockResolvedValue({ count: 3 });

    await service.markAllRead();

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { readAt: null },
      data: { readAt: expect.any(Date) },
    });
  });
});
