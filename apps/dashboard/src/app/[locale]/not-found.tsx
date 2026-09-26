// notFound() de una página del showcase (por ejemplo, un episodio inexistente
// o sin publicar, AC 3.68): se muestra dentro del layout del showcase, con su
// <html lang>. Un `locale` inválido no llega acá: lo resuelve
// app/global-not-found.tsx.
export default function ShowcaseNotFound() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">No encontrado</h1>
      <p className="text-muted-foreground">Este debate no existe o ya no está publicado.</p>
    </section>
  );
}
