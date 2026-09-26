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

**Nota 2026-09-25**: los nombres reales de los paquetes son `@ai-trend-debates/contracts` y `@ai-trend-debates/video` (`@contracts`/`@video` era una abreviatura de los docs). La revisión de la spec 003 encontró que `@ai-trend-debates/video` todavía no se puede importar desde el dashboard: `src/index.ts` llama a `registerRoot()` al importarse y las versiones de React no coinciden. La solución (entry de Studio separado, peers y catálogo de pnpm) está en la spec 003, "Restricciones técnicas".

---

## 2026-09-25

### 3. Autenticación: login de un solo usuario, sesión emitida por Nest, dashboard como único origen

**Contexto**: cierra el gap de la entrada #1 (nada separaba el panel de curación de la vista pública). Surgió al escribir la spec `docs/product/003-dashboard-ui.md`.

**Resolución**: el usuario eligió login de un solo usuario (credencial en `.env`, sesión por cookie). Descartó "solo uso local" y OAuth externo: es lo mínimo que permite publicar el sitio sin sumar un proveedor. La topología la propuso el agente `architect` al revisar la spec y el usuario la aceptó tal cual:
- Nest emite y valida la sesión, con un guard global que niega por defecto.
- Next es el único origen público y hace rewrite de `/api/*` y `/audio-files/*`.
- Se elimina el CORS abierto.

Motivo principal: `EventSource` no manda headers y las URLs de audio firmadas son relativas. Con un solo origen, la cookie, el SSE y el audio funcionan sin CORS ni `withCredentials`. Se descartó la sesión en memoria: permite revocar de verdad, pero cada reinicio del backend cierra la sesión. Detalle completo en `../../../docs/adr/0001-auth-sesion-nest-mismo-origen.md`.

### 4. Stack de UI y datos: Tailwind + shadcn/ui + TanStack Query + openapi-fetch

**Contexto**: la spec 003 tenía que definir cómo se consume la API y cómo se construye la UI antes de arrancar.

**Resolución** (el usuario eligió entre tres opciones):
- Tailwind, que ya viene en el scaffold.
- shadcn/ui: componentes accesibles copiados al repo, sin sumar una librería pesada.
- TanStack Query: cache e invalidación después de las acciones de curaduría y de los eventos SSE.
- Cliente generado con `openapi-typescript`/`openapi-fetch` desde `openapi.json`.

Se descartó "Tailwind + fetch nativo con Server Actions" porque se combina peor con el SSE y con el polling del inbox. El panel busca los datos del lado del cliente (`/api`, vía rewrite); solo el SSR del showcase llama a la API con `API_INTERNAL_URL`.

### 5. Showcase: episodios publicados explícitamente, con `@remotion/player`

**Resolución**: la vista pública muestra los episodios en `READY_FOR_RENDER` o posteriores **que el curador publicó** (`Episode.publishedAt`, acciones `publish`/`unpublish`). Se reproducen en vivo con `@remotion/player` contra el manifest, sin esperar al worker de render (Feature 9). El paso explícito de publicar lo pidió el usuario después de la revisión del `architect`: sin él, un episodio quedaba público antes de que el curador lo previsualizara.

---

## 2026-09-26

### 6. F1 implementada: límites del workspace, cliente tipado, dos layouts raíz y auth del panel

**Contexto**: la F1 (`tasks.md` §1, `roadmap.md` Fase 1) se hizo en la rama `feat/dashboard-f1`, en un git worktree aparte de la rama de backend. Incluye los dos ítems de Workspace de `tasks.md` raíz §12.1. Antes de escribir código de Next se leyeron las guías de la versión instalada (16.3.6): `proxy.md`, `internationalization.md`, `next-root-params.md`, `not-found.md`, `route-groups.md`, `rewrites.md`, `redirects.md` y `dynamicParams.md`.

**`check-boundaries` en la cadena de build.** Se sumó como tarea raíz de Turborepo (`//#check:boundaries`, sin caché) y todo `build` depende de ella. Se descartó un `prebuild` en `apps/dashboard`: solo cubriría ese paquete, y el script también protege `packages/*`. Consecuencia: `pnpm build` (y `turbo run build --filter ...`) corta ante una violación; un `next build` suelto no la corre. El script sigue siendo por regex, no un parser: ahora captura `from "x"`, `import "x"`, `import("x")` y `require("x")`, y compara por nombre exacto o subpath (`@ai-trend-debates/api/...`). En el review sumó alias de tsconfig, `/// <reference>`, comentarios dentro de `import(...)` y paths absolutos (ver más abajo). Un comentario con esa forma también cuenta; se prefiere un falso positivo visible a un import que pase.

**Tipos generados.** `src/lib/api/schema.d.ts` queda en `.gitignore`: lo genera `generate:api` antes de `build`, `dev`, `lint` y `test`, con `$TURBO_ROOT$/openapi.json` como input, así que no puede quedar desfasado. Hallazgo de la verificación pendiente de la spec: `openapi-typescript` 7.13.0 traduce `type: ["string","null"]` a `string | null` aunque el documento sea `openapi: 3.0.0`. Pasa con `avatarUrl` y con `participants[].role`, así que no hace falta tocar el backend. `EpisodeStatus` no es un schema con nombre en `openapi.json` (es un enum inline), así que el módulo de estados lo toma de `components["schemas"]["EpisodeDto_Output"]["status"]`. Con `Record<EpisodeStatus, ...>`, si la API suma, quita o renombra un estado, el build falla. Se probó el criterio de F1 renombrando `COMPLETED` en el enum y `password` en `LoginDto`: los dos casos fallan con `TS2353` en el type check de `next build`.

**Rewrites y `proxyTimeout`.** `API_INTERNAL_URL` tiene default `http://127.0.0.1:3000`, el `HOST`/`PORT` por defecto de la API, y se valida al cargar `next.config.ts`. Los rewrites se resuelven en build (quedan en `routes-manifest.json`), por eso la variable está en el `env` de `build` y `dev`. `proxyTimeout` es un timeout de inactividad del socket (`httpxy`: `proxyReq.setTimeout`), no de duración total. Se fijó en 10 minutos por la cuenta del peor caso de `regenerate-verdict`: 3 intentos de Cockatiel × (hasta 90 s del limitador de RPM + generación del LLM) + backoff, unos 5-6 minutos. Se verificó con curl que la URL interna no aparece en el HTML ni en `.next/static`.

**Spike de `global-not-found`** (Restricciones técnicas, "Layouts raíz separados"):
- El flag `experimental.globalNotFound` existe en 16.3.6 y se activó, con `app/global-not-found.tsx` en español y `lang="es"`. Solo enlaza al showcase, para no mostrar nada del panel (AC 3.6).
- Con Turbopack el archivo se toma aunque el flag esté apagado: el flag solo lo leen el loader de webpack y el lookup de rutas del server de desarrollo. Se deja prendido porque es lo que pide la documentación.
- `locale` inválido: con `generateStaticParams` + `dynamicParams = false` en `[locale]/layout.tsx`, `/en`, `/pt` y `/xx` no matcheaban ninguna ruta y respondían 404 con `global-not-found`. `dynamicParams = false` en el layout no bloquea los `[id]` de abajo (se probó con un placeholder que renderizaba). **Cambió en el review** (ver "Revisión de `code-reviewer`" más abajo): con `force-dynamic`, Next ignora `dynamicParams = false` y el 404 lo da el `notFound()` del layout.
- Red de seguridad: el layout igual valida el `locale` y llama a `notFound()`. Responde 404, pero un `notFound()` lanzado por el layout raíz no tiene boundary encima, y Next muestra su 404 por defecto, en inglés, en lugar de `global-not-found`. Antes del review solo lo alcanzaba `/en/e/[id]`; ahora también `/en` y `/xx`. Queda como tarea explícita de F4 (`tasks.md` §4). En el primer pase se descartó validar el `locale` en `proxy.ts` porque el ADR 0001 dice que el proxy solo hace el chequeo de la cookie. El review obligó a releer el ADR: ese "solo" se refiere a la autorización (Next no autoriza; la autorización real es el 401 de Nest), no a prohibir normalizar URLs. Por eso la canonicalización de mayúsculas entró en el proxy, y mandar los `locale` inválidos a `global-not-found` desde ahí queda como opción para F4.
- `notFound()` desde una página: se agregó un `not-found.tsx` dentro de cada layout raíz. Hallazgo: durante un render dinámico, Next 16.3.6 responde 404 con un documento de error (`<html id="__next_error__">`) cuyo payload RSC trae el layout raíz y el `not-found` del segmento, y el navegador lo completa del lado del cliente. Se reprodujo igual en el panel, en el showcase y sin `global-not-found`, así que no depende de esta estructura. No se pudo confirmar el render final en un navegador: los navegadores headless no dejaron salida en este entorno. Queda para verificar a mano con `/es/e/cualquier-id`.

**Auth del panel:**
- El manejo global del `401` (AC 3.7) está en el `QueryCache`/`MutationCache` del `QueryClient` y dispara solo con `code: UNAUTHORIZED`. El `401 INVALID_CREDENTIALS` del login lo maneja el formulario (AC 3.2). Redirige con navegación completa (`window.location.assign`), no con `router`, para descartar el caché de la sesión vencida. Agrega `expired=1` para el aviso "la acción no se ejecutó".
- `/studio/*` consulta `GET /auth/session` (`SessionCheck`, sin UI). Así, una cookie vencida o alterada lleva a `/login` aunque la pantalla todavía no pida datos. Si no, las páginas placeholder de F1 mostrarían el panel con cualquier cookie.
- `next` se valida en el servidor (`login/page.tsx`) con `new URL` sobre una base ficticia: el path ya resuelto tiene que ser `/studio` o `/studio/...`. Se rechazan de antemano `//`, `\` y los caracteres de control, porque los navegadores los normalizan a otro host.
- Login real verificado a través del rewrite: `200` con la cookie `HttpOnly; SameSite=Lax; Max-Age=604800`, `401 INVALID_CREDENTIALS`, `429 TOO_MANY_ATTEMPTS` con `Retry-After: 900` al sexto intento, y logout `204`. Para hacerlo sin la contraseña real se puso en el `.env` del worktree un hash de una contraseña de prueba y después se restauró la copia original. El `.env` del repo principal no se tocó.

**Dependencias:**
- shadcn/ui con base Radix y no con el preset por defecto del CLI (`base-nova`, sobre Base UI): es la base con la que se escribió el supuesto de AC 3.77 (diálogos con foco atrapado). Se puede cambiar sin tocar las pantallas de F1.
- El CLI actual de shadcn genera `cn` desde el paquete `cn` (repositorio `shadcn-ui/cn`, reemplazo de `clsx` + `tailwind-merge`). Se verificó el origen del paquete antes de aceptarlo.
- Vitest 4 y no 5, porque Vitest 5 pide `@types/node` 22 o superior y el scaffold fija `^20`. Cubre la lógica sin DOM (60 tests en el primer pase y 110 después del review: `next`, errores, 401 global y su redirección, proxy, path canónico, estados, `API_INTERNAL_URL`, mensajes de login). Los componentes no tienen tests de render: habría que sumar un entorno DOM, y en F1 son formularios y navegación sin lógica propia.

**Entorno**: en un worktree recién instalado, `pnpm build` falla en `apps/api` hasta correr `prisma generate` (y `prisma migrate deploy` para levantar la API con su `dev.db` relativa). No es un cambio de código; queda anotado para el próximo worktree.

**Revisión de `code-reviewer`** (misma rama, 2026-09-26):

- **Mayúsculas en el path (MEDIUM).**
  - *Hallazgo, reproducido en Windows antes del fix* (build limpio + `next start`):
    - El primer `GET /Studio` sin cookie respondió `200` con el panel: no matchea el matcher de `proxy.ts`, que distingue mayúsculas, y el filesystem encontró `studio.html`.
    - Después, Next resolvió `/Studio` y `/ES` como `[locale]`, el layout respondió 404 y ese 404 se guardó en el caché ISR con la clave `/Studio`. En disco es el mismo archivo que el prerender (`studio.meta` terminó con `"status":404` y el tag `_N_T_/Studio`).
    - Tras reiniciar, `/es` y `/studio` seguían en 404 con cookie. El problema existe en cualquier filesystem que no distinga mayúsculas: Windows, donde desarrolla el usuario, y macOS por defecto. El despliegue no está definido.
  - *Solución elegida, dos capas independientes*:
    1. `proxy.ts` canonicaliza: sobre el path decodificado con `decodeURI`, cualquier letra en mayúscula lleva a un 308 hacia la forma en minúsculas, antes del chequeo de la cookie. Se usa `decodeURI` y no `decodeURIComponent` para que `%2F` no se convierta en un separador; los escapes que quedan vuelven a su forma en mayúsculas del RFC 3986. El matcher pasa a ser todo salvo `/_next`, `/api` y `/audio-files`.
    2. El panel (`(panel)/studio/layout.tsx`) y el showcase (`[locale]/layout.tsx`) son `force-dynamic`: no queda HTML prerenderizado en disco para pisar.
  - *Por qué las dos*:
    - La canonicalización ataca la causa: ninguna variante llega al routing ni al caché, y `/Studio` pasa por el chequeo de la cookie. Además protege cualquier prerender futuro.
    - `force-dynamic` deja sin nada que envenenar aunque algo pase el proxy, por ejemplo una regresión del matcher o un encoding no previsto.
    - El panel no pierde nada con `force-dynamic`, porque no tiene datos de servidor (D11). El showcase es un placeholder hasta F4, y el caché de AC 3.72 se decide ahí.
  - *Por qué no una sola capa*:
    - Solo `force-dynamic` en `/studio` (lo que sugería el reviewer) dejaba `/ES` pisando `/es` y la omisión de `/Studio` en el proxy. En la reproducción, el primer `/Studio` sirvió el prerender antes de pisarlo.
    - Solo el proxy deja la integridad del caché en manos del matcher.
  - *Mayúsculas en IDs*: se canonicaliza el path completo, IDs incluidos, porque son UUID, que no distinguen mayúsculas (RFC 4122); `/es/e/ABC` va a `/es/e/abc`. Si algún día hay IDs que distinguen mayúsculas, hay que limitar la canonicalización a los segmentos de ruta.
  - *Homoglifos Unicode*: se probó en este NTFS qué nombres colisionan con `es.html`, `studio.html` y `login.html`. Solo colisionan las variantes ASCII de mayúsculas. `ſ`, `ı`, `ѕ`, el signo Kelvin y los caracteres de ancho completo no colisionan, así que `toLowerCase` cubre todo lo que colisiona.
  - *ADR 0001*: no lo contradice. El proxy sigue sin autorizar nada; normalizar la URL no es autorización.
  - *Costo aceptado*: con `force-dynamic`, Next ignora `dynamicParams = false`. `/en` y `/xx` siguen respondiendo 404, pero con la página por defecto de Next en lugar de `global-not-found`. Entra en la tarea de F4 sobre la 404 del showcase (`tasks.md` §4).
  - *Verificado después del fix* (build limpio + `next start`, con reinicio entre el ataque y el chequeo):
    - `/ES`, `/Es`, `/Studio`, `/STUDIO/new`, `/Studio/new`, `/LOGIN`, `/ES/e/abc`, `/%53tudio` y `/%73tudio` responden 308 a su forma canónica.
    - `/Studio` sin cookie termina en `/login?next=%2Fstudio`, sin servir el panel.
    - Después del reinicio, `/es`, `/studio` y `/studio/new` siguen en 200 con cookie, y no hay archivos `es.*` ni `studio.*` en `.next/server/app`.
    - `/es/e/a%20b` no entra en loop.
  - *Nota de Next 16.3.6*: la guía de `proxy.md` documenta `unstable_doesProxyMatch`, pero `next/experimental/testing/server` solo exporta `unstable_doesMiddlewareMatch`. El test de comportamiento del matcher usa este último.
- **`check-boundaries` (LOW)**: ahora detecta los alias de `compilerOptions.paths` del tsconfig de cada paquete, expandidos antes del chequeo (`@/../../api/src/x`), `/// <reference path>` (siempre relativo al archivo) y `/// <reference types>`, comentarios entre `import(`/`require(` y el specifier, y paths absolutos (`/x`, `C:\x`, `file:`). Probado en las dos direcciones: 21 casos prohibidos fallan; 3 permitidos (`@/lib/utils`, `@/../src/...`, un path absoluto dentro del paquete) y el estado real pasan. En el re-review se cambió la lectura del tsconfig. El regex que sacaba los comentarios `/* */` se comía el `/*` de `"@/*"`, y con un tsconfig comentado el script abortaba (`SyntaxError`, se reprodujo con la versión anterior). Ahora usa la API de `typescript` (`readConfigFile` + `parseJsonConfigFileContent`), que admite comentarios y resuelve `extends`, así que también toma los alias heredados. `typescript` no se resuelve desde la raíz del repo, así que se carga con `createRequire` desde cada paquete revisado, que lo tiene como devDependency. No se agregó ninguna dependencia. Si un paquete con tsconfig no resuelve `typescript`, el script falla con un mensaje explícito en lugar de saltear los alias. Probado con un tsconfig comentado y con los `paths` en un base heredado por `extends`: 8/8 casos correctos, y las 24 pruebas anteriores dan lo mismo.
- **bfcache (LOW)**: la redirección por 401 pasó a `src/lib/auth/login-redirect.ts`, con `location` inyectable. El flag que evita redirecciones duplicadas se resetea en `pageshow` con `persisted`; antes, al volver con "atrás" desde `/login`, los 401 dejaban de redirigir. Tests: tres 401 en paralelo producen una sola redirección, con `expired=1` y el `next` correcto, y después de un `pageshow` restaurado vuelve a redirigir.
- **NITs**: el espacio que faltaba en `lang={locale} className=`. Los componentes de shadcn importan `cn` desde `@/lib/utils`, como declara `components.json`; `utils.ts` sigue reexportando el paquete `cn`.
