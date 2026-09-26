import { NextResponse, type NextRequest } from "next/server";
import { canonicalPathname, isStudioPath } from "@/lib/auth/canonical-path";
import { buildLoginUrl } from "@/lib/auth/next-path";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";

// Dos cosas, en este orden:
//
// 1. Path canónico: cualquier variante con mayúsculas (o con letras
//    codificadas, `/%53tudio`) se redirige con 308 a su forma en minúsculas
//    antes de llegar al routing. Ver src/lib/auth/canonical-path.ts. No es
//    autorización: es normalización de URL.
//    Consecuencia: todo lo que va en public/ tiene que tener nombre en
//    minúsculas (carpetas incluidas). Un `public/Logo.png` nunca se serviría:
//    `/Logo.png` redirige a `/logo.png`, que no existe. Como el 308 es
//    permanente, los navegadores lo cachean aunque después se renombre el
//    archivo.
// 2. Chequeo optimista de la cookie (ADR 0001 punto 4; AC 3.1): sin cookie de
//    sesión, /studio/* redirige a /login?next=<ruta>. No valida la firma ni el
//    vencimiento: la autorización real es el 401 de la API (AC 3.7).
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const canonical = canonicalPathname(pathname);
  if (canonical !== null) {
    const url = request.nextUrl.clone();
    url.pathname = canonical;
    return NextResponse.redirect(url, 308);
  }

  if (!isStudioPath(pathname) || request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  return NextResponse.redirect(new URL(buildLoginUrl(`${pathname}${search}`), request.url));
}

// Todo salvo los assets de Next y los rewrites hacia la API (/api,
// /audio-files), que tienen sus propios paths y firmas. El matcher distingue
// mayúsculas, por eso no alcanza con "/studio/:path*": la canonicalización
// tiene que ver también /Studio.
export const config = {
  matcher: ["/((?!_next/|api/|audio-files/).*)"],
};
