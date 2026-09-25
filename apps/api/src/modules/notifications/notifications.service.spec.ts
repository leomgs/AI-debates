import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { z } from "zod";
import { NotificationsService } from "./notifications.service";
import { MarkAllNotificationsReadSchema, NotificationSchema } from "./dto/notification.schema";

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
    prisma.notification.update.mockResolvedValue(row({ readAt: new Date() }));

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

  // API-5: lo que devuelven los 3 endpoints tiene que cumplir el schema
  // documentado en openapi.json (fechas ISO, readAt nullable).
  describe("shape de respuesta (API-5)", () => {
    it("list serializa las fechas a ISO y deja readAt en null si no está leída", async () => {
      prisma.notification.findMany.mockResolvedValue([row({ readAt: null })]);

      const result = await service.list(true);

      expect(result).toEqual([
        {
          id: NOTIFICATION_ID,
          episodeId: EPISODE_ID,
          type: "EPISODE_PENDING_REVIEW",
          message: "El episodio está listo para revisión.",
          readAt: null,
          createdAt: "2026-09-25T10:00:00.000Z",
        },
      ]);
      expect(z.array(NotificationSchema).safeParse(result).success).toBe(true);
    });

    it("markRead devuelve la notificación con readAt en ISO", async () => {
      prisma.notification.update.mockResolvedValue(row({ readAt: new Date("2026-09-25T11:00:00.000Z") }));

      const result = await service.markRead(NOTIFICATION_ID);

      expect(result.readAt).toBe("2026-09-25T11:00:00.000Z");
      expect(NotificationSchema.safeParse(result).success).toBe(true);
    });

    it("markAllRead devuelve cuántas marcó", async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.markAllRead();

      expect(result).toEqual({ count: 3 });
      expect(MarkAllNotificationsReadSchema.safeParse(result).success).toBe(true);
    });
  });
});

function row(overrides: { readAt: Date | null }) {
  return {
    id: NOTIFICATION_ID,
    episodeId: EPISODE_ID,
    type: "EPISODE_PENDING_REVIEW",
    message: "El episodio está listo para revisión.",
    createdAt: new Date("2026-09-25T10:00:00.000Z"),
    ...overrides,
  };
}
