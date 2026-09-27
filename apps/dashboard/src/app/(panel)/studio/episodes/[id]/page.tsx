import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Episodio",
};

// Placeholder del bloque F2-A: la ruta existe para que "Crear episodio" y el
// inbox puedan navegar al episodio (AC 3.12, AC 3.24). El detalle y la vista
// en vivo (AC 3.26-3.41) llegan en el bloque F2-B.
export default function EpisodeDetailPage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Episodio</h1>
      <p className="text-muted-foreground">El detalle del episodio todavía no está disponible.</p>
      <Link href="/studio" className="text-sm underline-offset-4 hover:underline">
        Volver a la lista de episodios
      </Link>
    </section>
  );
}
