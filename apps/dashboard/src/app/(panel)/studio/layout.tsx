import { PanelNav } from "@/components/panel/panel-nav";
import { SessionCheck } from "@/components/panel/session-check";

// Layout de /studio/* (AC 3.15). La protección optimista la hace src/proxy.ts;
// SessionCheck confirma la sesión contra la API para que una cookie vencida
// o alterada lleve a /login aunque la pantalla todavía no consulte datos
// (AC 3.3, AC 3.7).
export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SessionCheck />
      <header className="border-b">
        <PanelNav />
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
    </>
  );
}
