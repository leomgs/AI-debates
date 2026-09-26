import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3100${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe("proxy (AC 3.1; ADR 0001 punto 4)", () => {
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

  it("solo corre en /studio y /studio/*", () => {
    expect(config.matcher).toEqual(["/studio", "/studio/:path*"]);
  });
});
