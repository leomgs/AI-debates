import { NextRequest } from "next/server";
// La guía de proxy.md (16.3.6) documenta `unstable_doesProxyMatch`, pero el
// paquete instalado solo exporta el nombre anterior.
import { unstable_doesMiddlewareMatch as unstable_doesProxyMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import { config, proxy } from "./proxy";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3100${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("proxy: chequeo optimista de la cookie (AC 3.1; ADR 0001 punto 4)", () => {
  it("sin cookie de sesión redirige a /login?next=<ruta>", () => {
    const response = proxy(request("/studio/episodes/abc?tab=live"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3100/login?next=%2Fstudio%2Fepisodes%2Fabc%3Ftab%3Dlive",
    );
  });

  it("con cookie vacía también redirige", () => {
    const response = proxy(request("/studio", "atd_session="));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3100/login?next=%2Fstudio");
  });

  it("con cookie deja pasar sin validarla (la autorización real es el 401 de la API)", () => {
    const response = proxy(request("/studio/new", "atd_session=123.firma"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["/es", "/es/e/abc", "/login", "/studiox", "/studio-evil"])("no pide sesión fuera del panel: %s", (path) => {
    const response = proxy(request(path));
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("proxy: path canónico en minúsculas (filesystem que no distingue mayúsculas)", () => {
  it.each([
    ["/Studio", "/studio"],
    ["/STUDIO/new?x=1", "/studio/new?x=1"],
    ["/ES", "/es"],
    ["/Es/e/ABC", "/es/e/abc"],
    ["/%53tudio", "/studio"],
    ["/%73tudio", "/studio"],
  ])("%s redirige con 308 a %s, antes de mirar la cookie", (path, expected) => {
    const response = proxy(request(path));
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`http://localhost:3100${expected}`);
  });

  it("un path ya canónico con escapes legítimos no se redirige a sí mismo", () => {
    const response = proxy(request("/es/e/a%20b"));
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("proxy: en qué rutas corre", () => {
  const matches = (url: string) => unstable_doesProxyMatch({ config, nextConfig, url });

  it.each(["/studio", "/studio/new", "/studio/episodes/1", "/Studio", "/STUDIO/new", "/ES", "/es", "/login"])(
    "corre en %s",
    (url) => {
      expect(matches(url)).toBe(true);
    },
  );

  it.each(["/api/episodes", "/audio-files/x.mp3", "/_next/static/chunks/a.js"])("no corre en %s", (url) => {
    expect(matches(url)).toBe(false);
  });
});
