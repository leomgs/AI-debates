// Path canónico del dashboard: todas las rutas propias (/login, /studio/*,
// /es, /es/e/<uuid>) son en minúsculas, y los ids son UUID, que no
// distinguen mayúsculas (RFC 4122). Canonicalizar evita dos problemas de un
// filesystem que no distingue mayúsculas (Windows, macOS por defecto):
//
// - `/Studio` no matchea el matcher de proxy.ts y saltea el chequeo de la
//   cookie; Next lo resuelve como `[locale] = "Studio"`.
// - Ese render responde 404 y Next lo guarda en el caché ISR con la clave
//   `/Studio`, que en disco es el mismo archivo que el prerender de `/studio`
//   (o `/ES` pisa `/es`): la ruta buena queda en 404 hasta el próximo build.
//
// Se decodifica con decodeURI (no decodeURIComponent) para que `/%53tudio`
// cuente como `/Studio` sin convertir `%2F` en un separador de segmentos.

/** Devuelve el path canónico, o null si `pathname` ya lo es. */
export function canonicalPathname(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURI(pathname);
  } catch {
    return null; // escape inválido: que lo resuelva el routing (404)
  }
  // Se re-codifica con el mismo algoritmo que usa URL para el pathname, así un
  // path con escapes legítimos (`%20`) no se redirige a sí mismo en loop.
  // Los escapes que decodeURI deja (`%2F`, `%3F`...) vuelven a su forma en
  // mayúsculas, la canónica de RFC 3986: no son letras de la ruta.
  const lowered = decoded.toLowerCase().replace(/%[0-9a-f]{2}/g, (escape) => escape.toUpperCase());
  const canonical = new URL(lowered, "http://canonical.invalid").pathname;
  return canonical === pathname ? null : canonical;
}

/** `/studio` y `/studio/*`, sobre el path ya canónico. */
export function isStudioPath(pathname: string): boolean {
  return pathname === "/studio" || pathname.startsWith("/studio/");
}
