import { describe, expect, it } from "vitest";
import { EPISODE_STATUS_UI } from "./episode-status";
import { NOTIFICATION_RELATED_STATUS, isUnread, sortNotifications, unreadBadgeText, type Notification } from "./notifications";
import { POLLING_INTERVALS_MS } from "./polling";
import { episodeHref } from "./routes";

function notification(id: string, createdAt: string, readAt: string | null = null): Notification {
  return { id, episodeId: `ep-${id}`, type: "EPISODE_PENDING_REVIEW", message: "El episodio está listo para revisión.", readAt, createdAt };
}

describe("inbox de notificaciones (spec 003, sección 2)", () => {
  it("cada tipo usa la categoría visual del estado relacionado (AC 3.11)", () => {
    const category = (type: Notification["type"]) => EPISODE_STATUS_UI[NOTIFICATION_RELATED_STATUS[type]].category;
    expect(category("EPISODE_PENDING_REVIEW")).toBe("attention");
    expect(category("EPISODE_REQUIRES_REVIEW")).toBe("attention");
    expect(category("EPISODE_FAILED")).toBe("error");
    expect(category("EPISODE_COMPLETED")).toBe("ready");
  });

  it("ordena de más nueva a más vieja sin modificar la lista recibida (AC 3.11)", () => {
    const input = [
      notification("vieja", "2026-09-01T00:00:00.000Z"),
      notification("nueva", "2026-09-27T00:00:00.000Z"),
      notification("media", "2026-09-10T00:00:00.000Z"),
    ];
    expect(sortNotifications(input).map((n) => n.id)).toEqual(["nueva", "media", "vieja"]);
    expect(input[0]?.id).toBe("vieja");
  });

  it("sin leer = readAt null", () => {
    expect(isUnread(notification("a", "2026-09-01T00:00:00.000Z"))).toBe(true);
    expect(isUnread(notification("a", "2026-09-01T00:00:00.000Z", "2026-09-02T00:00:00.000Z"))).toBe(false);
  });

  it("contador compacto", () => {
    expect(unreadBadgeText(3)).toBe("3");
    expect(unreadBadgeText(99)).toBe("99");
    expect(unreadBadgeText(100)).toBe("99+");
  });

  it("navega al detalle del episodio (AC 3.12)", () => {
    expect(episodeHref("0b5f3c0e-1d2a-4e8b-9c1f-2a3b4c5d6e7f")).toBe("/studio/episodes/0b5f3c0e-1d2a-4e8b-9c1f-2a3b4c5d6e7f");
    expect(episodeHref("a/b?c")).toBe("/studio/episodes/a%2Fb%3Fc");
  });
});

describe("intervalos de polling (D19, AC 3.86)", () => {
  it("30 s el inbox, 10 s el detalle y la lista", () => {
    expect(POLLING_INTERVALS_MS).toEqual({ inbox: 30_000, episodeDetail: 10_000, episodeList: 10_000 });
  });
});
