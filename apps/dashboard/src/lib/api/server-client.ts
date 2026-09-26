import "server-only";
import createClient from "openapi-fetch";
import { resolveApiInternalUrl } from "./internal-url";
import type { paths } from "./schema";

// Cliente para el render de servidor (D11): lo usa solo el showcase público
// (F4), contra API_INTERNAL_URL. No reenvía cookies ni ningún header del
// request entrante: el servidor de Next nunca actúa en nombre del curador,
// así que desde acá solo se alcanzan endpoints públicos.
export function createServerApiClient() {
  return createClient<paths>({ baseUrl: resolveApiInternalUrl() });
}
