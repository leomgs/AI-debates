import type { Metadata } from "next";
import { Suspense } from "react";
import { EpisodeList, EpisodeListSkeleton } from "@/components/panel/episode-list";

export const metadata: Metadata = {
  title: "Episodios",
};

// Lista de episodios agrupada por "requiere acción" (spec 003, sección 3).
// Los datos se piden desde el navegador (D11). EpisodeList lee el filtro con
// useSearchParams; el Suspense es el que pide la guía de Next para ese hook,
// aunque /studio no se prerenderiza (force-dynamic en el layout).
export default function StudioHomePage() {
  return (
    <Suspense fallback={<EpisodeListSkeleton />}>
      <EpisodeList />
    </Suspense>
  );
}
