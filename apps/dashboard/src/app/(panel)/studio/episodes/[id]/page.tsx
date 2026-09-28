import type { Metadata } from "next";
import { EpisodeDetailView } from "@/components/panel/episode-detail";

export const metadata: Metadata = {
  title: "Episodio",
};

// Detalle de episodio y vista en vivo (spec 003, sección 5). El servidor
// solo lee el id de la ruta: los datos se piden desde el navegador (D11).
// La `key` reinicia el feed y la suscripción SSE al pasar a otro episodio.
export default async function EpisodeDetailPage({ params }: PageProps<"/studio/episodes/[id]">) {
  const { id } = await params;
  return <EpisodeDetailView key={id} episodeId={id} />;
}
