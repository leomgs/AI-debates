// Placeholder de F1: la lista del showcase (AC 3.66, AC 3.71) llega en F4,
// cuando exista GET /showcase/episodes (API-7).
export default function ShowcaseHomePage() {
  return (
    <section className="space-y-2">
      <h1 className="text-2xl font-semibold">Debates publicados</h1>
      <p className="text-muted-foreground">Todavía no hay debates publicados.</p>
    </section>
  );
}
