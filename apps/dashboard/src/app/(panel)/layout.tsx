import type { Metadata } from "next";
import "../globals.css";
import { fontVariables } from "@/lib/fonts";
import { QueryProvider } from "@/components/panel/query-provider";

// Layout raíz del panel de curación (/login y /studio/*). La interfaz del
// panel es en español (D8), así que el documento declara lang="es"
// (AC 3.79 a). El route group no agrega segmento: las URLs siguen siendo
// /login y /studio/*.
export const metadata: Metadata = {
  title: {
    default: "Panel — AI Trend Debates",
    template: "%s — Panel — AI Trend Debates",
  },
  // El panel es privado: nada de indexarlo.
  robots: { index: false, follow: false },
};

export default function PanelRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${fontVariables} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
