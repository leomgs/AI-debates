import Link from "next/link";

// notFound() de una página del panel: se muestra dentro del layout del panel
// (lang="es"). Las URLs que no matchean ninguna ruta las resuelve
// app/global-not-found.tsx.
export default function PanelNotFound() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-2 px-6 py-8">
      <h1 className="text-2xl font-semibold">No encontrado</h1>
      <p className="text-muted-foreground">Lo que buscás no existe.</p>
      <Link href="/studio" className="underline underline-offset-4">
        Volver a los episodios
      </Link>
    </main>
  );
}
