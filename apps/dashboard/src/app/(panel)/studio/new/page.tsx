import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Crear episodio",
};

// Placeholder de F1: el formulario de creación (AC 3.22-3.25, AC 3.78) llega
// en F2, junto con el idioma del debate (API-17).
export default function NewEpisodePage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Crear episodio</h1>
      <p className="text-muted-foreground">La creación de episodios todavía no está disponible.</p>
    </section>
  );
}
