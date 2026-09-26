# 0001 — Auth del curador: sesión emitida y validada por Nest, dashboard como único origen

Estado: **aceptado** (2026-09-25). Origen: spec `docs/product/003-dashboard-ui.md`, decisión D1 (login de un solo usuario, decisión del usuario). Propuesto por el agente `architect` en la revisión de la spec 003; topología y semántica de sesión confirmadas por el usuario. Alcance del punto 4 aclarado el 2026-09-26 (review de la F1 del dashboard; ver "Aclaración: alcance de `src/proxy.ts`").

## Contexto

La spec 003 exige login de un solo usuario con credencial en `.env`, sesión por cookie, protección real en la API (no solo en el front) y un showcase público sin login. Hechos del código que condicionan la decisión:

- `app.enableCors()` está abierto (`apps/api/src/main.ts:22`); su comentario ("frontend de Remotion") está obsoleto — Remotion Studio usa un fixture y no llama al backend.
- Las URLs de audio firmadas son **relativas** (`/audio-files/...?expires&sig`, `apps/api/src/modules/tts/local-disk-storage.provider.ts:29`): el navegador las resuelve contra el origen del dashboard.
- El SSE se consume con `EventSource`, que no manda headers propios; entre orígenes distintos necesita `withCredentials` + CORS con credenciales.
- El proxy de rewrites de Next corta sockets tras 30 s de inactividad (`next/dist/server/lib/router-utils/proxy-request.js:37`, `proxyTimeout || 30000`).

## Decisión

1. **Nest emite y valida la sesión**: `modules/auth` (`POST /auth/login`, `POST /auth/logout`, `GET /auth/session`), módulo de aplicación sin tablas propias. `SessionGuard` global (`APP_GUARD`) que niega por defecto, con un decorador `@Public()` en `shared/http/public.decorator.ts` solo en login/logout, `/showcase/*` y `GET /`.
2. **Cookie** `httpOnly`, `SameSite=Lax`, `Path=/`, sin `Domain`, `Secure` según entorno. Valor: token sin estado firmado con HMAC (`exp` + firma, mismo patrón que `apps/api/src/modules/tts/audio-url-signer.ts`), vigencia 7 días. `CURATOR_USERNAME`, `CURATOR_PASSWORD_HASH` (scrypt de `node:crypto`) y `SESSION_SECRET` en `apps/api/.env`, validados en `EnvSchema`, sin defaults.
3. **Next es el único origen público**: rewrites `/api/:path*` y `/audio-files/:path*` hacia `API_INTERNAL_URL`. Nest no se expone directamente. Se elimina `enableCors()`. `apps/dashboard` no tiene carpeta `app/api` (chocaría con el prefijo).
4. **Next solo hace un chequeo optimista** en `src/proxy.ts` (Next 16; cookie presente en `/studio/*` → si no, `/login?next=`). La autorización real es el `401` de Nest, manejado por el cliente tipado. El parámetro `next` se valida como ruta relativa `/studio/...` (evita open redirect). El "solo" limita lo que el proxy hace con la sesión, no le prohíbe normalizar ni rutear URLs: ver "Aclaración: alcance de `src/proxy.ts`".
5. `/audio-files` sigue protegido solo por la firma HMAC (necesario para el showcase). En producción `EnvSchema` falla si `AUDIO_SIGNING_SECRET` conserva el default.
6. El SSE emite `heartbeat` cada 15 s mientras el pipeline está activo (evita el corte de 30 s del rewrite y de cualquier reverse proxy).

## Consecuencias

- (+) Cookie, SSE y audio funcionan sin CORS ni `withCredentials`; las URLs relativas de audio no cambian.
- (+) Una sola fuente de verdad de la sesión; se verifica con `curl` directo a la API (`401`).
- (+) Todo endpoint nuevo queda protegido por defecto.
- (−) Cerrar sesión no revoca una cookie copiada antes de su vencimiento; revocar todas las sesiones = rotar `SESSION_SECRET`.
- (−) El despliegue exige que Next alcance a Nest por red interna; `API_INTERNAL_URL` se necesita en build (declararla en `env` de Turborepo).
- (−) `/docs` queda fuera del guard (middleware de Swagger). Resuelto por D20 de la spec 003: se monta solo fuera de producción (implementado en API-8).

## Aclaración: alcance de `src/proxy.ts` (2026-09-26)

El punto 4 fija que Next no autoriza: no valida la sesión y no decide qué puede ver o hacer el usuario. No limita el proxy a leer la cookie. Surgió en el review de la F1 del dashboard: en un filesystem que no distingue mayúsculas, `/Studio` salteaba el chequeo de la cookie, y `/ES` o `/Studio` pisaban en el caché ISR el prerender de `/es` y `/studio` (`apps/dashboard/docs/decision-log.md`, entrada 6).

Criterio: la respuesta del proxy depende solo del request (método, path, query) y de constantes empaquetadas en el dashboard. La única excepción es la presencia de la cookie de sesión, según el punto 4.

- **Permitido**:
  - normalizar la URL con un redirect (hoy, 308 de cualquier path con mayúsculas a su forma en minúsculas, `src/lib/auth/canonical-path.ts`);
  - rutear a páginas propias del dashboard, incluida la 404 (por ejemplo, mandar a `global-not-found` un `locale` que no está en `SHOWCASE_LOCALES`);
  - el chequeo optimista del punto 4.
- **No permitido**:
  - validar la firma o el vencimiento de la cookie (exigiría `SESSION_SECRET` en Next, y habría dos fuentes de verdad de la sesión);
  - llamar a la API o a cualquier fuente de datos, o decidir la visibilidad de un recurso: si un episodio existe o está publicado lo resuelve el render contra Nest;
  - crear o modificar cookies, o agregar credenciales a los rewrites;
  - responder con contenido propio (sigue sin haber backend en Next, punto 3).
- `/api/*` y `/audio-files/*` quedan fuera del matcher: sus paths y firmas son de Nest y no se normalizan.

Consecuencia: el proxy corre sobre todo el sitio salvo `/_next`, `/api` y `/audio-files`, no solo sobre `/studio/*`. Una regla nueva en el proxy que necesite datos o secretos no entra por esta aclaración: requiere un ADR nuevo que reemplace el punto 4.

## Alternativas consideradas

- **Orígenes distintos + CORS con credenciales**: URLs de audio absolutas, cookie con dominio compartido, `withCredentials` en `EventSource`, allowlist de orígenes — más superficie de configuración y rompe el formato relativo actual.
- **Sesión emitida por Next (Auth.js / BFF con route handlers)**: secreto compartido entre procesos o todo el tráfico (SSE incluido) por route handlers propios; Nest tiene que validar igual para que la API quede protegida.
- **Sesión con estado en memoria de Nest**: revocación real, pero cada reinicio del backend desloguea. Descartada por el usuario.
