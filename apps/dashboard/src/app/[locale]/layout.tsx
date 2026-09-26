import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../globals.css";
import { fontVariables } from "@/lib/fonts";
import { SHOWCASE_LOCALES, isShowcaseLocale } from "@/lib/locales";

// Layout raíz del showcase público (D9, D16; AC 3.6, AC 3.79). Sin controles
// ni enlaces del panel. `locale` es el idioma de la interfaz, no el del
// debate; cualquier valor fuera de SHOWCASE_LOCALES responde 404 (AC 3.80).
export const metadata: Metadata = {
  title: "AI Trend Debates",
  description: "Debates entre agentes de IA sobre temas del momento, verificados y con veredicto.",
};

// Sin prerender ni caché ISR: en un filesystem que no distingue mayúsculas,
// el 404 de `/ES` se guardaba encima del HTML de `/es` (decision-log del
// dashboard, entrada 6). La primera defensa es la canonicalización de
// proxy.ts; esta es la segunda. F4 decide el caché del showcase (AC 3.72) y,
// si vuelve a prerenderizar, depende de que la canonicalización siga activa.
export const dynamic = "force-dynamic";

// Con force-dynamic, dynamicParams y generateStaticParams no tienen efecto:
// no se prerenderiza nada y un `locale` desconocido igual llega a este layout.
// Se dejan para cuando F4 vuelva a prerenderizar el showcase: ahí un `locale`
// fuera de la lista no matchea la ruta y responde 404 con
// app/global-not-found.tsx, sin renderizar el layout.
export const dynamicParams = false;

export function generateStaticParams() {
  return SHOWCASE_LOCALES.map((locale) => ({ locale }));
}

export default async function ShowcaseRootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  // Hoy, este notFound() es el que responde 404 a todo `locale` inválido
  // (/en, /xx, /en/e/[id]). Como sale del layout raíz, no tiene un boundary
  // encima y Next muestra su 404 por defecto (en inglés, sin lang) en lugar
  // de global-not-found. Pendiente de F4 (tasks.md §4, "Página 404 del
  // showcase"; decision-log del dashboard, entrada 6).
  if (!isShowcaseLocale(locale)) notFound();

  return (
    <html lang={locale} className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b">
          <div className="mx-auto flex w-full max-w-5xl items-center px-4 py-4">
            <a href={`/${locale}`} className="text-lg font-semibold">
              AI Trend Debates
            </a>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
