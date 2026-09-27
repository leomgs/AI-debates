import type { Metadata } from "next";
import { CreateEpisodeForm } from "@/components/panel/create-episode-form";

export const metadata: Metadata = {
  title: "Crear episodio",
};

// Crear episodio (spec 003, sección 4): tópico e idioma del debate.
export default function NewEpisodePage() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Crear episodio</h1>
      <CreateEpisodeForm />
    </section>
  );
}
