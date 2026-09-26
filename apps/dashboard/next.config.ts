import type { NextConfig } from "next";
import { resolveApiInternalUrl } from "./src/lib/api/internal-url";

const apiInternalUrl = resolveApiInternalUrl();

// Timeout de inactividad del socket del rewrite hacia la API
// (httpxy: proxyReq.setTimeout). Por defecto Next corta a los 30 s
// (next/dist/server/lib/router-utils/proxy-request.js), y la acción más
// lenta es sincrónica: regenerate-verdict (API-19) y regenerate hacen hasta
// 3 intentos (Cockatiel, maxAttempts: 3), y cada intento puede esperar hasta
// 90 s al limitador de RPM (MAX_WAIT_MS) antes de la llamada al LLM, más el
// backoff entre intentos. 3 × (90 s + generación) queda en unos 5-6 minutos;
// 10 minutos deja margen. El SSE no depende de esto (heartbeat cada 15 s,
// API-13), pero también queda cubierto.
const PROXY_TIMEOUT_MS = 10 * 60 * 1000;

const nextConfig: NextConfig = {
  experimental: {
    proxyTimeout: PROXY_TIMEOUT_MS,
  },

  // Next es el único origen público (ADR 0001 punto 3; AC 3.9). Como array,
  // los rewrites se aplican después del filesystem y antes de las rutas
  // dinámicas, así que [locale] no captura /api ni /audio-files. No existe
  // app/api en el dashboard (chocaría con este prefijo).
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${apiInternalUrl}/:path*` },
      { source: "/audio-files/:path*", destination: `${apiInternalUrl}/audio-files/:path*` },
    ];
  },
};

export default nextConfig;
