import createClient from "openapi-fetch";
import type { paths } from "./schema";

// Cliente de la API para el navegador (D11). Mismo origen: /api se reescribe
// hacia API_INTERNAL_URL en next.config.ts, así que la URL interna nunca
// aparece en el navegador (AC 3.9) y la cookie de sesión viaja sola
// (credentials "same-origin", el default de fetch).
//
// Sin timeout propio: las acciones sincrónicas largas (regenerate,
// regenerate-verdict) no pueden cortarse antes que el rewrite
// (experimental.proxyTimeout).
export const API_BASE_URL = "/api";

export const api = createClient<paths>({ baseUrl: API_BASE_URL });
