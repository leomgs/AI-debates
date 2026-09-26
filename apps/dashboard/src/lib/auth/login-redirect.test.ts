import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { createPanelQueryClient } from "@/lib/query-client";
import { createLoginRedirect, type LoginRedirectEnv } from "./login-redirect";

function fakeEnv(pathname: string, search = "") {
  const assigned: string[] = [];
  const pageshowListeners: Array<(event: { persisted: boolean }) => void> = [];
  const env: LoginRedirectEnv = {
    location: { pathname, search, assign: (url) => assigned.push(url) },
    addEventListener: (_type, listener) => pageshowListeners.push(listener),
  };
  const pageshow = (persisted: boolean) => pageshowListeners.forEach((listener) => listener({ persisted }));
  return { env, assigned, pageshow };
}

const unauthorized = () => new ApiError({ status: 401, code: "UNAUTHORIZED", message: "Sin sesión" });

describe("createLoginRedirect (AC 3.7)", () => {
  it("varios 401 en paralelo producen una sola redirección, con expired=1 y next de la ruta actual", async () => {
    const { env, assigned } = fakeEnv("/studio/episodes/abc", "?tab=live");
    const client = createPanelQueryClient({ onUnauthorized: createLoginRedirect(env) });

    const results = await Promise.allSettled(
      ["a", "b", "c"].map((key) => client.fetchQuery({ queryKey: [key], queryFn: () => Promise.reject(unauthorized()) })),
    );

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(assigned).toEqual(["/login?next=%2Fstudio%2Fepisodes%2Fabc%3Ftab%3Dlive&expired=1"]);
  });

  it("vuelve a redirigir después de una restauración desde el bfcache (pageshow con persisted)", () => {
    const { env, assigned, pageshow } = fakeEnv("/studio");
    const redirectToLogin = createLoginRedirect(env);

    redirectToLogin();
    redirectToLogin();
    expect(assigned).toHaveLength(1);

    pageshow(true);
    redirectToLogin();
    expect(assigned).toHaveLength(2);
  });

  it("un pageshow de una carga normal (persisted false) no resetea", () => {
    const { env, assigned, pageshow } = fakeEnv("/studio");
    const redirectToLogin = createLoginRedirect(env);

    redirectToLogin();
    pageshow(false);
    redirectToLogin();
    expect(assigned).toHaveLength(1);
  });

  it("fuera del panel, next cae en /studio", () => {
    const { env, assigned } = fakeEnv("/login");
    createLoginRedirect(env)();
    expect(assigned).toEqual(["/login?next=%2Fstudio&expired=1"]);
  });
});
