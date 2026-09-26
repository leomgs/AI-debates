import { NextResponse, type NextRequest } from "next/server";
import { buildLoginUrl } from "@/lib/auth/next-path";
import { SESSION_COOKIE } from "@/lib/auth/session-cookie";

// Chequeo optimista (ADR 0001 punto 4; AC 3.1): sin cookie de sesión, /studio/*
// redirige a /login?next=<ruta>. No valida la firma ni el vencimiento: la
// autorización real es el 401 de la API, que maneja el cliente (AC 3.7).
export function proxy(request: NextRequest) {
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  return NextResponse.redirect(new URL(buildLoginUrl(`${pathname}${search}`), request.url));
}

export const config = {
  matcher: ["/studio", "/studio/:path*"],
};
