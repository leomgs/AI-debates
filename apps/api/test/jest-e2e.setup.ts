import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { E2E_CURATOR_PASSWORD_HASH, E2E_CURATOR_USERNAME, E2E_SESSION_SECRET } from "./e2e-auth.fixture";

// Los tests e2e bootstrapean AppModule completo, que valida el env al
// arrancar (ver env.schema.ts). GOOGLE_API_KEY y TAVILY_API_KEY son las
// requeridas — acá les damos un valor dummy para no depender de keys reales
// en CI/local.
process.env.GOOGLE_API_KEY ??= "test-google-api-key";
process.env.TAVILY_API_KEY ??= "test-tavily-api-key";

// API-8: credencial del curador y secreto de sesión, sin defaults en
// EnvSchema. Asignación directa (no ??=) a propósito: los tests e2e hacen
// login con E2E_CURATOR_PASSWORD, así que no pueden heredar la credencial
// real que el desarrollador tenga exportada en su shell.
process.env.CURATOR_USERNAME = E2E_CURATOR_USERNAME;
process.env.CURATOR_PASSWORD_HASH = E2E_CURATOR_PASSWORD_HASH;
process.env.SESSION_SECRET = E2E_SESSION_SECRET;

// EpisodesModule agrega EpisodeRecoveryService.onApplicationBootstrap()
// (Fase E), que consulta Episode contra la DATABASE_URL real del proceso
// apenas AppModule bootstrapea — sin esto, correr `npm run test:e2e` usaría
// dev.db (la base real de desarrollo). Si algún día dev.db tuviera un
// episodio real "stuck" en RESEARCHING/DEBATING/JUDGING, correr los tests
// e2e dispararía llamadas reales a LLM/Tavily sin que nadie lo pidiera —
// encontrado en revisión al terminar EpisodesModule, no corregido por el
// agente que implementó la Fase E (quedó marcado como fuera de su scope).
// Se aísla con una DB de test propia (mismo patrón que
// episodes.integration.spec.ts: archivo temporal, migrada con `prisma
// migrate deploy` antes de bootstrapear, recreada desde cero en cada corrida
// para no depender de estado de una corrida anterior).
const TEST_DB_PATH = join(__dirname, "tmp-e2e.db");
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  const path = TEST_DB_PATH + suffix;
  if (existsSync(path)) rmSync(path);
}
process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
execSync("npx prisma migrate deploy", {
  cwd: join(__dirname, ".."),
  env: process.env,
  stdio: "inherit",
});
