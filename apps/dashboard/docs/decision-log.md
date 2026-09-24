# Decision Log — Dashboard (front)

Mismo criterio que el `decision-log.md` de la raíz del repo: bitácora del *proceso* detrás de cada decisión no obvia, no solo el resultado. Acá solo las decisiones puramente del front — ver `README.md` de esta carpeta para dónde vive el resto.

---

## 2026-09-24

### 1. Framework del dashboard: Next.js (no Vite+React)

**Contexto**: al revisar las specs `001-openapi-contract-zod.md` y `002-workspace-restructure.md` contra el estado real del proyecto, apareció la pregunta de qué framework usar para el dashboard — ninguna spec la resolvía, y el proyecto no tenía nada de frontend arrancado todavía.

**Restricción dura, no de gusto**: `@remotion/player` (necesario para previsualizar el video en el dashboard antes de renderizarlo, ver `002-workspace-restructure.md`) es un componente React. Cualquier framework que no sea React (o no pueda embeber React) queda descartado de entrada — Vue/Svelte/Angular no sirven acá sin meter un micro-app React adentro. La decisión real es entre frameworks React.

**Opciones consideradas**:
- **Vite + React (SPA)** — dev loop más rápido, sin la complejidad de SSR. Encaja con el shape de un panel de curación puro (lista de episodios → detalle → acciones `approve`/`edit`/`regenerate`/`reject` contra la API REST/SSE ya existente).
- **Next.js** — es lo que usan los templates oficiales de Remotion para combinar player + trigger de renders server-side, y encaja mejor con Turborepo (mismo equipo, Vercel). Trae SSR/routing/API routes.

**Resolución**: el dashboard no va a ser solo un panel interno de curación — también va a tener una **vista pública/showcase de episodios terminados** (mostrar debates como portfolio). Esa parte pública sí se beneficia de SSR (indexabilidad, tiempo de carga inicial). Con las dos superficies (panel privado + vista pública) en el mismo proyecto, Next.js pesa más que Vite pese al overhead que agrega para el panel de curación en sí.

**Gap real, sin resolver todavía**: no hay ninguna estrategia de autenticación que separe el panel de curación (privado, debería ser solo para el dueño del proyecto) de la vista pública (debería ser accesible para cualquiera). Hoy nada en el proyecto — ni backend ni las specs 001/002 — define esto. Queda anotado acá como el primer ítem a resolver antes de exponer el dashboard más allá de uso local, y como no-objetivo explícito de `002-workspace-restructure.md` (que solo crea el scaffold vacío, sin páginas).

### 2. Dependencias del dashboard: `packages/video` y `packages/contracts` vía workspace, sin publicar nada

**Contexto**: parte de por qué el dashboard terminó en este mismo repo (`002-workspace-restructure.md`, decisión "el dashboard vive en este mismo repo") es justamente para que pueda importar `packages/video` directo (preview en vivo con `@remotion/player`) sin necesidad de publicarlo a un registry.

**Resolución**: `apps/dashboard` depende de `@contracts` (tipos de `RemotionManifest` y lo que exponga `openapi.json` vía `openapi-typescript`) y, cuando exista preview en vivo, de `@video` — ambos resueltos por el workspace de pnpm, no instalados como paquetes publicados. No hay nada más que decidir acá hasta que exista código real.
