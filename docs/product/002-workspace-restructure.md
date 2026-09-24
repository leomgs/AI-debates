# 002 — Workspace: separar API, video y contratos

Estado: **implementada y verificada** (2026-09-24 — ver `decision-log.md` #30 para el proceso completo, incluido el bloqueante real de `better-sqlite3` sin binarios precompilados y la verificación con un render real de Remotion). Ajustada el 2026-09-24 tras revisión contra el estado real del repo antes de implementar (`decision-log.md` #28) — el texto original lo trajo el usuario ya escrito; lo que sigue conserva su estructura y sus decisiones, con las correcciones marcadas donde el repo real no coincidía con lo asumido.

Esta tarea mueve archivos y toca paths de import; hacerla en paralelo con otra cosa produce un diff imposible de revisar.

## Contexto

Hoy el repo es una sola aplicación NestJS. La parte de video (Remotion) va a crecer con themes, personas y composiciones, y necesita poder iterarse sin levantar la base de datos ni gastar llamadas a LLMs. Además va a existir un dashboard, **en este mismo repo** (`apps/dashboard`, ver nota de la revisión más abajo) que consume la API por HTTP.

Esta tarea establece los límites entre las piezas.

## Decisiones

Cada decisión incluye su razón. La razón es parte del contrato.

- **El video es un paquete que la API importa, no un servicio hermano.** Porque la API es quien dispara el render. No hay comunicación en red entre ambos, hay una llamada a función.
- **`packages/video` no importa nada de `apps/api`.** Porque su única entrada tiene que ser un `RemotionManifest` más las URLs de audio. Esa restricción es lo que permite abrir el Remotion Studio contra un fixture JSON e iterar la UI del video en segundos, sin Postgres/SQLite, sin claves de API y sin costo por iteración.
- **`RemotionManifest` vive en `packages/contracts`.** Porque es el contrato entre dos paquetes y no pertenece a ninguno de los dos. Se define en Zod, con los tipos inferidos exportados. **Nota de la revisión**: el schema Zod de `RemotionManifest` ya existe cuando esta tarea arranca — lo crea la spec 001 (co-ubicado en `apps/api`, ver su plan de implementación paso 2). Acá **se mueve tal cual está**, no se reescribe.
- **`pnpm` + `Turborepo`.** Porque con 4 paquetes reales en el workspace (`apps/api`, `packages/contracts`, `packages/video`, `apps/dashboard`) hace falta más que resolución de dependencias: pnpm evita que un paquete dependa en silencio de algo "hoisteado" desde otro (la garantía exacta que necesita `packages/video` para ser verdaderamente independiente de `apps/api`), y Turborepo agrega caché + orquestación de tareas (`build`/`test`/`dev`) sin el peso de Nx. **Esto reemplaza la decisión original del texto pegado** ("no se migra a Nx ni a Turborepo, pnpm workspaces alcanza") — se revirtió por chat al confirmar que el dashboard entra al mismo repo (ver siguiente punto), lo que sube de 3 a 4 paquetes y hace más real el dolor de "recompilar todo por un cambio chico".
- **El dashboard vive en este mismo repo, como `apps/dashboard`.** **Esto invierte la decisión original del texto pegado** ("el dashboard va en un repo aparte"). Motivo real, resuelto por chat: si el dashboard quiere preview en vivo del video (`@remotion/player` embebido contra `packages/video`) antes de que exista el worker de render (Feature 9, todavía no arranca), necesita importar `packages/video` directo — en un repo aparte, eso obliga a publicarlo (aunque sea a un registry privado) solo para poder tener esa preview, overhead real para un proyecto personal. En el mismo repo lo importa gratis vía el workspace. El aislamiento de toolchain/deploy que buscaba la razón original se preserva **por paquete**, no por repo: `apps/dashboard` puede tener su propio pipeline de deploy sin que eso requiera un repo separado. Existe una carpeta hermana ya reservada, `ai-trend-debates-front/` (vacía, sin `git init`, creada junto con el `.clinerules/rules.md` compartido, antes de casi todo el trabajo de backend) que asumía la idea de repo aparte — queda **superada** por esta decisión, no se borra en esta tarea.
- **El core del video no conoce los themes.** Porque queremos poder explorar variantes visuales tocando solo un directorio. El core arma secuencias desde el manifest y recibe los componentes visuales desde un theme inyectado.

## No-objetivos

Fuera de alcance en esta tarea. Si algo de esto parece necesario, parar y preguntar:

- No se cambia ningún comportamiento de la API. Esto es un movimiento de archivos y configuración, nada más.
- **No se construye la UI real del dashboard** (páginas, componentes, embed del player, vista pública de episodios). `apps/dashboard` en esta tarea es un **scaffold vacío** (`create-next-app` default, sin páginas propias) wireado al workspace/Turborepo — la UI real es una spec 003 futura, todavía no escrita. El framework (Next.js) y el resto de las decisiones de producto del dashboard viven en `apps/dashboard/docs/`, no acá.
- No se diseñan themes nuevos ni se implementan personas. Solo se establece la estructura. **Nota de la revisión**: no hay nada de Remotion que "mover" — no existe ninguna dependencia `remotion` ni código relacionado en el repo hoy. `packages/video` se **crea** desde cero con el esqueleto mínimo (ver plan de implementación), no se migra código existente.
- No se define autenticación ni el split entre panel de curación privado y vista pública del dashboard — gap real sin resolver, anotado en `apps/dashboard/docs/decision-log.md`, pendiente de la spec 003.
- No se cambia el schema de `RemotionManifest`; se mueve tal cual está (ya migrado a Zod por la spec 001).

## Estructura objetivo

```
ai-trend-debates/
  apps/
    api/                      NestJS (todo lo que hoy está en la raíz de este repo)
    dashboard/                Next.js — scaffold vacío en esta tarea (ver no-objetivos)
      docs/                   roadmap/tasks/decision-log propios del front (ya existen,
                               creados antes que el código real — ver apps/dashboard/docs/)
  packages/
    contracts/
      src/remotion-manifest.ts    schema Zod + tipos inferidos (movido desde apps/api, spec 001 lo crea)
      src/index.ts
    video/
      src/core/                   secuencias armadas desde el manifest
      src/themes/<id>/            cada variante visual
      src/personas/               rigs de personajes
      src/index.ts                registry de themes + composiciones
      fixtures/debate.sample.json fixture congelado para iterar
  openapi.json
  pnpm-workspace.yaml
  turbo.json
  roadmap.md / tasks.md / decision-log.md / architecture.md / features.md /
  api-contract.md / coding-rules.md / frontend-notes.md / setup.md / README.md /
  docs/                       suben a la raíz del monorepo (ver plan de implementación) —
                               describen las 4 piezas, no solo la API
```

## Restricciones técnicas

- **Un commit para mover, otro para ajustar.** Primero el movimiento de archivos sin cambios de contenido, después los ajustes de imports y configuración. Hace el diff revisable y permite identificar qué rompió si algo rompe.
- **Los paths de TypeScript se resuelven por `references` o por `paths`, no por imports relativos que salgan del paquete.** Un `../../packages/contracts/src/...` dentro de `apps/api` es una violación del límite disfrazada de import válido.
- **El fixture tiene que ser suficiente por sí solo.** `fixtures/debate.sample.json` debe permitir renderizar una composición completa sin ninguna variable de entorno. Si hace falta un audio, que sea un archivo estático en el paquete.
- **Verificar las versiones reales en `package.json` antes de tocar configuración de build.** Aplica especialmente a la configuración de Remotion (a instalar de cero, ver no-objetivos) y al `tsconfig`.

## Plan de implementación

1. Crear `pnpm-workspace.yaml` con `apps/*` y `packages/*`. Migrar el repo de npm a pnpm (borrar `package-lock.json`, `pnpm import`, verificar instalación limpia — detalle completo del proceso de migración en `decision-log.md` #28).
2. Mover la aplicación NestJS actual a `apps/api/` sin cambios de contenido. Verificar que compila y que los tests pasan antes de seguir.
3. Mover los docs de raíz (`roadmap.md`, `tasks.md`, `decision-log.md`, `architecture.md`, `features.md`, `api-contract.md`, `coding-rules.md`, `frontend-notes.md`, `setup.md`, `README.md`, `docs/`) a la raíz del monorepo (no a `apps/api/`) — actualizar cualquier referencia cruzada que dependa de paths relativos.
4. Crear `packages/contracts` con el schema de `RemotionManifest` movido desde `apps/api` (donde lo dejó la spec 001). Exportar schema y tipos.
5. Ajustar `apps/api` para importar el manifest desde `@contracts` (o el nombre que se elija, declarado en el `package.json` de cada paquete).
6. Crear `packages/video` con la estructura de `core`, `themes`, `personas` y `fixtures` **desde cero** (no hay nada existente que mover — ver no-objetivos). Alcance mínimo: un `core` que arme una secuencia simple desde el manifest, un fixture congelado, y una composición placeholder — suficiente para que `video:studio` abra y renderice algo real, no un sistema de themes completo.
7. Crear `apps/dashboard` como scaffold Next.js vacío (`create-next-app` default, sin páginas propias) y wirearlo al workspace/Turborepo.
8. Agregar el fixture y un script `video:studio` que abra el Remotion Studio contra él.
9. Configurar Turborepo (`turbo.json`) con el pipeline de tareas (`build`/`test`/`dev`) respetando el grafo de dependencias entre paquetes.
10. Agregar la verificación de límites (ver criterio de aceptación).
11. Registrar la decisión en `decision-log.md`.

## Criterio de aceptación

- `pnpm build` compila todos los paquetes (incluido el scaffold vacío de `apps/dashboard`).
- Los tests existentes pasan sin modificaciones de aserciones.
- `pnpm openapi:generate && git diff --exit-code openapi.json` sigue dando 0: la reestructuración no cambió la API.
- `pnpm video:studio` abre el Remotion Studio y renderiza una composición contra el fixture con el archivo `.env` renombrado temporalmente y sin la base de datos levantada. Esta es la verificación central de la tarea.
- Un chequeo automatizado falla si aparece un import de `apps/api` dentro de `packages/video` (o de cualquier `apps/*` dentro de `packages/*`). Puede ser una regla de ESLint de límites o, como mínimo viable, un script que haga grep y devuelva código distinto de 0.
- Ningún archivo bajo `packages/` importa con paths relativos que salgan de su propio paquete.

## Bitácora

Implementada y documentada en `decision-log.md` #30 — incluye la estructura de workspace adoptada, la regla de que el video no depende de la API y por qué, la decisión de traer el dashboard a este mismo repo, y los hallazgos reales encontrados implementando: `corepack` no funciona en la máquina de desarrollo (resuelto con `npm install -g pnpm`), `better-sqlite3@13.x` no publica binarios precompilados (bajado a `^12.11.1`, bloqueante real que impedía reinstalar dependencias), el gate de seguridad de pnpm para scripts de instalación, `transformIgnorePatterns` de Jest roto bajo la estructura anidada de pnpm, `RemotionManifestDto` (la clase `createZodDto`) se queda en `apps/api` en vez de `packages/contracts` (refinamiento sobre la redacción literal), y el pin exacto de `zod` que pide Remotion para su sistema de props tipadas.

La revisión previa a esta spec (por qué el texto original se ajustó, antes de implementar) quedó documentada en `decision-log.md` #28.

**Pendiente real, no bloqueante**: `packages/video` tiene un solo theme placeholder sin audio (reproducir audio real es trabajo de la spec 003 de UI, todavía sin escribir); `apps/dashboard` es un scaffold vacío sin ninguna página propia (mismo motivo).
