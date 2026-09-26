import { notFound } from "next/navigation";

// Placeholder de F1: el detalle público (AC 3.67) llega en F4 con
// GET /showcase/episodes/:id (API-7). Hasta entonces ningún episodio está
// publicado, así que todo id es "no encontrado" (el mismo resultado que
// AC 3.68 para un episodio sin publicar). La ruta existe para fijar la
// forma de las URLs del showcase desde F1 (D16).
export default function ShowcaseEpisodePage() {
  notFound();
}
