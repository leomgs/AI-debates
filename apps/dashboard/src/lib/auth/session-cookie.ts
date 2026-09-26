// Nombre de la cookie de sesión que emite la API (api-contract.md §1.1).
// Es httpOnly: el navegador no la lee; solo la mira src/proxy.ts.
export const SESSION_COOKIE = "atd_session";
