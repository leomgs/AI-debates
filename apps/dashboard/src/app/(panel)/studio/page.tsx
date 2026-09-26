import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Episodios",
};

// Placeholder de F1: la lista agrupada (AC 3.16-3.21) llega en F2.
export default function StudioHomePage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Episodios</h1>
      <p className="text-muted-foreground">La lista de episodios todavía no está disponible.</p>
    </section>
  );
}
