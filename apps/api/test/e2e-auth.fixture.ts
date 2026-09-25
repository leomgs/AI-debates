// Credencial fija de los tests e2e (API-8). jest-e2e.setup.ts la carga en
// process.env antes de bootstrapear AppModule — process.env tiene prioridad
// sobre apps/api/.env en ConfigModule, así que la credencial real del
// desarrollador nunca participa de los tests. El hash corresponde a
// E2E_CURATOR_PASSWORD (generado con el script auth:hash-password).
export const E2E_CURATOR_USERNAME = "curador-e2e";
export const E2E_CURATOR_PASSWORD = "test-password";
export const E2E_CURATOR_PASSWORD_HASH =
  "scrypt:16384:8:1:_9YJqs4PlFzDq1FBH0ZrMw:YU4EDvCZx4gNmnpcMxmlvdEbIz694zQ7qmQcgAYqQtCl4ndZ8h6_X67Yb_1s6kxIjr8FGM9HvDxyTMUGz4_mGA";
export const E2E_SESSION_SECRET = "e2e-session-secret-0123456789abcdef";
