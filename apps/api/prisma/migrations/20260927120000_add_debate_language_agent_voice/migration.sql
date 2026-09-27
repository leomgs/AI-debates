-- Spec 004 (docs/product/004-debate-language.md, Restricciones técnicas,
-- "Migración") y ADR 0002 (puntos 1, 2, 6 y 7): idioma del debate por
-- episodio y voces por agente, idioma y proveedor en la tabla AgentVoice.
-- Escrita a mano y aplicada con `prisma migrate deploy` (decision-log.md
-- #21). Tercera de la cola de la F2, después de add_verdict_history.
--
-- El orden importa: el paso 3 lee Agent.voiceId, así que tiene que correr
-- antes de reconstruir Agent sin esa columna (paso 4).
--
-- Los valores nuevos de enum (DebateLanguage y
-- CheckpointReason.VOICE_NOT_CONFIGURED) no llevan SQL: en SQLite los enums
-- son TEXT y los valida Prisma ORM.

-- 1. CreateTable
CREATE TABLE "AgentVoice" (
    "agentId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,

    PRIMARY KEY ("agentId", "language", "provider"),
    CONSTRAINT "AgentVoice_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 2. Copia las voces de Agent.voiceId (Json Record<provider, string>,
-- decision-log.md #20) como ES. Sin placeholders ni filas de OPENROUTER
-- (spec 004, D14): se excluye 'TBD' y solo se copian LOCAL y GOOGLE_TTS.
-- El filtro por key también descarta un voiceId guardado como string suelto
-- (json_each devuelve key NULL), que no es una voz por proveedor.
INSERT INTO "AgentVoice" ("agentId", "language", "provider", "voiceId")
SELECT "Agent"."id", 'ES', voice."key", voice."value"
FROM "Agent", json_each("Agent"."voiceId") AS voice
WHERE voice."key" IN ('LOCAL', 'GOOGLE_TTS')
  AND voice."type" = 'text'
  AND voice."value" NOT IN ('TBD', '');

-- 3. AlterTable + backfill (spec 004, pregunta B; AC 4.16): cada AudioAsset
-- existente queda con la voz LOCAL que tenía su agente al migrar. Se llega
-- al agente por Argument.audioAssetId (1:1, @unique) -> Argument.agentId.
-- Un asset sin Argument queda en NULL (se resuelve por idioma, ADR 0002
-- punto 6).
ALTER TABLE "AudioAsset" ADD COLUMN "voiceId" TEXT;

UPDATE "AudioAsset"
SET "voiceId" = (
    SELECT NULLIF(json_extract("Agent"."voiceId", '$.LOCAL'), 'TBD')
    FROM "Argument"
    JOIN "Agent" ON "Agent"."id" = "Argument"."agentId"
    WHERE "Argument"."audioAssetId" = "AudioAsset"."id"
);

-- 4. RedefineTables: Agent sin voiceId, mismo patrón PRAGMA que
-- 20260909120000_agent_voiceid_json_add_openrouter. Las FKs que apuntan a
-- Agent (Argument, Verdict, EpisodeParticipant y la nueva AgentVoice) se
-- conservan porque referencian la tabla por nombre y los ids no cambian.
-- VerdictHistory no tiene FK a Agent (API-19).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "avatarUrl" TEXT,
    "systemPrompt" TEXT NOT NULL
);
INSERT INTO "new_Agent" ("id", "name", "role", "avatarUrl", "systemPrompt") SELECT "id", "name", "role", "avatarUrl", "systemPrompt" FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- 5. AlterTable: todos los episodios existentes quedan en ES (AC 4.5).
ALTER TABLE "Episode" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'ES';

-- Índices para debate.verdict.stale (spec 003, API-19;
-- DebateService.isVerdictStale corre en cada GET /episodes/:id).
-- CreateIndex
CREATE INDEX "ArgumentHistory_argumentId_createdAt_idx" ON "ArgumentHistory"("argumentId", "createdAt");

-- CreateIndex
CREATE INDEX "DebateRound_debateId_idx" ON "DebateRound"("debateId");
