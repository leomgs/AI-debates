import { describe, expect, it } from "vitest";
import { buildLoginUrl, sanitizeNextPath } from "./next-path";

describe("sanitizeNextPath (AC 3.1)", () => {
  it.each([
    ["/studio", "/studio"],
    ["/studio/", "/studio/"],
    ["/studio/new", "/studio/new"],
    ["/studio/episodes/abc?tab=live#feed", "/studio/episodes/abc?tab=live#feed"],
  ])("acepta la ruta del panel %s", (raw, expected) => {
    expect(sanitizeNextPath(raw)).toBe(expected);
  });

  it.each([
    [undefined],
    [null],
    [""],
    [["/studio/new", "/studio"]],
    ["https://evil.com/studio"],
    ["//evil.com/studio"],
    ["/\\evil.com"],
    ["\\\\evil.com"],
    ["/studio\\..\\..\\evil"],
    ["javascript:alert(1)"],
    ["studio/new"],
    ["/login"],
    ["/es"],
    ["/studio-evil"],
    ["/studiox/new"],
    ["/studio/../login"],
    ["/studio/%2e%2e/login"],
    ["/studio/\nnew"],
    ["/studio/\tnew"],
  ])("cae en /studio con %j", (raw) => {
    expect(sanitizeNextPath(raw as string | string[] | null | undefined)).toBe("/studio");
  });
});

describe("buildLoginUrl", () => {
  it("arma /login?next= con la ruta saneada", () => {
    expect(buildLoginUrl("/studio/episodes/1?x=1")).toBe("/login?next=%2Fstudio%2Fepisodes%2F1%3Fx%3D1");
  });

  it("marca la sesión vencida para el aviso de AC 3.7", () => {
    expect(buildLoginUrl("/studio/new", { sessionExpired: true })).toBe("/login?next=%2Fstudio%2Fnew&expired=1");
  });

  it("no propaga un next fuera del panel", () => {
    expect(buildLoginUrl("//evil.com")).toBe("/login?next=%2Fstudio");
  });
});
