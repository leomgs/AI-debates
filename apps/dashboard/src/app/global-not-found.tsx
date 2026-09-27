import type { Metadata } from "next";
import "./globals.css";
import { fontVariables } from "@/lib/fonts";
import { DEFAULT_SHOWCASE_LOCALE } from "@/lib/locales";

// 404 global (experimental.globalNotFound en next.config.ts). Con dos layouts
// raíz y sin app/layout.tsx no hay un layout común para las URLs que no
// matchean ninguna ruta (por ejemplo, /foo/bar). Next saltea el render normal
// y devuelve este documento completo.
//
// No cubre los `locale` inválidos del showcase (/en, /xx): mientras
// [locale]/layout.tsx sea force-dynamic, esas URLs matchean la ruta y el 404
// sale del notFound() del layout, con la 404 por defecto de Next. Vuelve a
// cubrirlos si F4 prerenderiza el showcase (dynamicParams = false), o si
// proxy.ts los manda acá (tasks.md §4, "Página 404 del showcase").
//
// Sirve a las dos superficies, así que no muestra nada del panel (AC 3.6):
// la interfaz de ambas es en español (D8, D16) y el único enlace es al showcase.
export const metadata: Metadata = {
  title: "Página no encontrada — AI Trend Debates",
};

export default function GlobalNotFound() {
  return (
    <html lang="es" className={`${fontVariables} dark h-full antialiased`}>
      <body className="flex min-h-full flex-col items-center justify-center gap-4 px-4 text-center">
        <h1 className="text-2xl font-semibold">Página no encontrada</h1>
        <p className="text-muted-foreground">La dirección no existe o ya no está disponible.</p>
        <a href={`/${DEFAULT_SHOWCASE_LOCALE}`} className="underline underline-offset-4">
          Ir a los debates publicados
        </a>
      </body>
    </html>
  );
}
