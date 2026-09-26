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

// Un `locale` fuera de generateStaticParams no matchea la ruta: Next responde
// 404 con app/global-not-found.tsx antes de renderizar este layout (/en, /xx).
export const dynamicParams = false;

export function generateStaticParams() {
  return SHOWCASE_LOCALES.map((locale) => ({ locale }));
}

export default async function ShowcaseRootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  // Red de seguridad para las rutas dinámicas de abajo (/en/e/[id]), que
  // igual llegan a renderizar este layout: responde 404, pero un notFound()
  // lanzado por el layout raíz no tiene boundary propio y Next muestra su
  // 404 por defecto en lugar de global-not-found (decision-log del dashboard).
  if (!isShowcaseLocale(locale)) notFound();

  return (
    <html lang={locale}className={`${fontVariables} h-full antialiased`}>
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
