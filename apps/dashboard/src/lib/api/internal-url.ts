// URL de la API vista desde el servidor de Next (ADR 0001 punto 3). La usan
// los rewrites de next.config.ts, que se resuelven en build, y el cliente
// de servidor (D11). Nunca llega al navegador (AC 3.9).
//
// Default: http://127.0.0.1:3000, el HOST y el PORT por defecto de
// apps/api (.env.example). En un despliegue donde Next y la API no
// comparten máquina, API_INTERNAL_URL es obligatoria en build y en runtime.
export const DEFAULT_API_INTERNAL_URL = "http://127.0.0.1:3000";

export function resolveApiInternalUrl(value: string | undefined = process.env.API_INTERNAL_URL): string {
  const raw = value?.trim() || DEFAULT_API_INTERNAL_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`API_INTERNAL_URL no es una URL válida: "${raw}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`API_INTERNAL_URL tiene que ser http o https: "${raw}"`);
  }
  // Sin barra final, para concatenar "/:path*" en los rewrites.
  return url.toString().replace(/\/+$/, "");
}
