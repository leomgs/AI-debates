import { buildLoginUrl } from "./next-path";

// Lo mínimo de `window` que usa la redirección: inyectable para testearla.
export interface LoginRedirectEnv {
  location: { pathname: string; search: string; assign(url: string): void };
  addEventListener(type: "pageshow", listener: (event: { persisted: boolean }) => void): void;
}

// Redirección a /login ante un 401 UNAUTHORIZED (AC 3.7). Navegación
// completa (no router.replace): descarta el caché de consultas de la sesión
// vencida. `redirecting` evita que varios 401 en paralelo disparen varias
// redirecciones. Se resetea en `pageshow` con `persisted`: si el navegador
// restaura la página desde el bfcache (botón "atrás" después de ir a
// /login), el módulo vuelve con el flag en true y, sin el reset, los 401
// siguientes ya no redirigirían.
export function createLoginRedirect(env: LoginRedirectEnv): () => void {
  let redirecting = false;
  let listening = false;

  return function redirectToLogin() {
    if (redirecting) return;
    redirecting = true;
    if (!listening) {
      listening = true;
      env.addEventListener("pageshow", (event) => {
        if (event.persisted) redirecting = false;
      });
    }
    const current = `${env.location.pathname}${env.location.search}`;
    env.location.assign(buildLoginUrl(current, { sessionExpired: true }));
  };
}
