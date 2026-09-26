// Parámetro `next` de /login (AC 3.1; ADR 0001 punto 4). Solo se vuelve a
// rutas relativas del panel: `/studio` o `/studio/...`. Cualquier otro valor
// (URL absoluta, `//dominio`, `/\dominio`, otra ruta del sitio) cae en
// /studio, así /login no sirve de open redirect.
export const STUDIO_HOME = "/studio";
export const LOGIN_PATH = "/login";
export const SESSION_EXPIRED_PARAM = "expired";

// Base ficticia para resolver la ruta sin depender del host real.
const PROBE_ORIGIN = "http://panel.invalid";

export function sanitizeNextPath(raw: string | string[] | null | undefined): string {
  if (typeof raw !== "string" || raw === "") return STUDIO_HOME;
  // Tiene que ser relativa a la raíz: "/..." pero no "//..." (protocol-
  // relative). Las barras invertidas y los caracteres de control se
  // rechazan porque los navegadores los normalizan (`/\evil.com` = `//evil.com`).
  if (!raw.startsWith("/") || raw.startsWith("//")) return STUDIO_HOME;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return STUDIO_HOME;

  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return STUDIO_HOME;
  }
  if (url.origin !== PROBE_ORIGIN) return STUDIO_HOME;
  // Se chequea el path ya resuelto: "/studio/../login" termina en "/login".
  if (url.pathname !== STUDIO_HOME && !url.pathname.startsWith(`${STUDIO_HOME}/`)) return STUDIO_HOME;

  return `${url.pathname}${url.search}${url.hash}`;
}

export function buildLoginUrl(nextPath: string, options: { sessionExpired?: boolean } = {}): string {
  const params = new URLSearchParams({ next: sanitizeNextPath(nextPath) });
  if (options.sessionExpired) params.set(SESSION_EXPIRED_PARAM, "1");
  return `${LOGIN_PATH}?${params.toString()}`;
}
