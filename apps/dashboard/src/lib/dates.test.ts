import { describe, expect, it } from "vitest";
import { formatAbsoluteDate, formatRelativeDate, formatTimeOfDay } from "./dates";

describe("formatTimeOfDay (feed en vivo, AC 3.74)", () => {
  it("hora con segundos en la zona indicada", () => {
    const iso = "2026-09-27T02:30:05.000Z";
    expect(formatTimeOfDay(iso, { timeZone: "UTC" })).toBe("2:30:05");
    expect(formatTimeOfDay(iso, { timeZone: "America/Argentina/Buenos_Aires" })).toBe("23:30:05");
  });
});

const NOW = new Date("2026-09-27T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe("formatRelativeDate (AC 3.74)", () => {
  it("menos de un minuto: hace un momento", () => {
    expect(formatRelativeDate(NOW.toISOString(), NOW)).toBe("hace un momento");
    expect(formatRelativeDate(minutesAgo(0.5), NOW)).toBe("hace un momento");
  });

  it("minutos, horas y días en español", () => {
    expect(formatRelativeDate(minutesAgo(5), NOW)).toBe("hace 5 minutos");
    expect(formatRelativeDate(minutesAgo(3 * 60), NOW)).toBe("hace 3 horas");
    expect(formatRelativeDate(minutesAgo(24 * 60), NOW)).toBe("ayer");
    expect(formatRelativeDate(minutesAgo(3 * 24 * 60), NOW)).toBe("hace 3 días");
  });
});

describe("formatAbsoluteDate (AC 3.74)", () => {
  it("usa la zona horaria indicada (en el navegador, la del navegador)", () => {
    const iso = "2026-09-27T02:30:00.000Z";
    const utc = formatAbsoluteDate(iso, { timeZone: "UTC" });
    const buenosAires = formatAbsoluteDate(iso, { timeZone: "America/Argentina/Buenos_Aires" });
    expect(utc).toContain("27");
    expect(utc).toContain("2:30");
    // UTC-3: el mismo instante cae el día anterior.
    expect(buenosAires).toContain("26");
    expect(buenosAires).toContain("23:30");
  });
});
