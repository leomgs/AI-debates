/*
  Warnings:

  - You are about to alter the column `voiceId` on the `Agent` table. The data
    in that column will be cast from `String` to `Json` (existing plain-text
    values are wrapped as JSON strings via json_quote() so the cast doesn't
    lose data — prisma/seed.ts re-seeds them as the real Record<provider,
    voiceId> shape right after this migration runs, see decision-log.md
    2026-09-09 #20).

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Agent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "avatarUrl" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "voiceId" JSONB NOT NULL
);
INSERT INTO "new_Agent" ("id", "name", "role", "avatarUrl", "systemPrompt", "voiceId") SELECT "id", "name", "role", "avatarUrl", "systemPrompt", json_quote("voiceId") FROM "Agent";
DROP TABLE "Agent";
ALTER TABLE "new_Agent" RENAME TO "Agent";
CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
