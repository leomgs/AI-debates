import { describe, expect, it } from "vitest";
import { canonicalPathname, isStudioPath } from "./canonical-path";

describe("canonicalPathname", () => {
  it.each(["/", "/es", "/studio/new", "/es/e/0f8c2c3a-1b2c-4d5e-8f90-123456789abc", "/es/e/a%20b", "/es/e/%C3%A9"])(
    "%s ya es canónico",
    (path) => {
      expect(canonicalPathname(path)).toBeNull();
    },
  );

  it.each([
    ["/Studio", "/studio"],
    ["/ES", "/es"],
    ["/es/e/0F8C2C3A-1B2C-4D5E-8F90-123456789ABC", "/es/e/0f8c2c3a-1b2c-4d5e-8f90-123456789abc"],
    ["/%53tudio", "/studio"],
    ["/%73tudio", "/studio"],
    ["/es/e/%c3%a9", "/es/e/%C3%A9"],
  ])("%s → %s", (path, expected) => {
    expect(canonicalPathname(path)).toBe(expected);
  });

  it("no convierte %2F en un separador de segmentos", () => {
    expect(canonicalPathname("/es/e/a%2Fb")).toBeNull();
    expect(canonicalPathname("/ES/e/a%2Fb")).toBe("/es/e/a%2Fb");
  });

  it("un escape inválido no se toca (lo resuelve el routing)", () => {
    expect(canonicalPathname("/es/%E0%A4%A")).toBeNull();
  });
});

describe("isStudioPath", () => {
  it.each(["/studio", "/studio/", "/studio/new"])("%s es del panel", (path) => {
    expect(isStudioPath(path)).toBe(true);
  });

  it.each(["/studiox", "/studio-evil", "/es", "/login"])("%s no es del panel", (path) => {
    expect(isStudioPath(path)).toBe(false);
  });
});
