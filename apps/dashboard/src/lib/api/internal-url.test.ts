import { describe, expect, it } from "vitest";
import { DEFAULT_API_INTERNAL_URL, resolveApiInternalUrl } from "./internal-url";

describe("resolveApiInternalUrl", () => {
  it("usa el HOST y PORT por defecto de la API si no hay valor", () => {
    expect(resolveApiInternalUrl(undefined)).toBe(DEFAULT_API_INTERNAL_URL);
    expect(resolveApiInternalUrl("  ")).toBe(DEFAULT_API_INTERNAL_URL);
  });

  it("saca la barra final para concatenar los rewrites", () => {
    expect(resolveApiInternalUrl("http://api.internal:3000/")).toBe("http://api.internal:3000");
  });

  it("rechaza valores que no son URLs http(s)", () => {
    expect(() => resolveApiInternalUrl("api:3000")).toThrow(/http o https/);
    expect(() => resolveApiInternalUrl("no es una url")).toThrow(/no es una URL válida/);
  });
});
