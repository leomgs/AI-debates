/*
  Warnings:

  - You are about to drop the column `status` on the `Debate` table. All the data in the column will be lost.
  - You are about to alter the column `remotionManifest` on the `Episode` table. The data in that column could be lost. The data in that column will be cast from `String` to `Json`.
  - You are about to drop the column `status` on the `Topic` table. All the data in the column will be lost.
  - Added the required column `type` to the `DebateRound` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "role" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Argument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "debateRoundId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "audioAssetId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "origin" TEXT NOT NULL DEFAULT 'AI_GENERATED',
    "respondsToId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Argument_debateRoundId_fkey" FOREIGN KEY ("debateRoundId") REFERENCES "DebateRound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Argument_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Argument_audioAssetId_fkey" FOREIGN KEY ("audioAssetId") REFERENCES "AudioAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Argument_respondsToId_fkey" FOREIGN KEY ("respondsToId") REFERENCES "Argument" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Argument" ("agentId", "audioAssetId", "content", "createdAt", "debateRoundId", "id", "origin", "status") SELECT "agentId", "audioAssetId", "content", "createdAt", "debateRoundId", "id", "origin", "status" FROM "Argument";
DROP TABLE "Argument";
ALTER TABLE "new_Argument" RENAME TO "Argument";
CREATE UNIQUE INDEX "Argument_audioAssetId_key" ON "Argument"("audioAssetId");
CREATE TABLE "new_Debate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "topicId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Debate_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Debate" ("createdAt", "id", "topicId", "updatedAt") SELECT "createdAt", "id", "topicId", "updatedAt" FROM "Debate";
DROP TABLE "Debate";
ALTER TABLE "new_Debate" RENAME TO "Debate";
CREATE TABLE "new_DebateRound" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "debateId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    CONSTRAINT "DebateRound_debateId_fkey" FOREIGN KEY ("debateId") REFERENCES "Debate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DebateRound" ("debateId", "id", "round") SELECT "debateId", "id", "round" FROM "DebateRound";
DROP TABLE "DebateRound";
ALTER TABLE "new_DebateRound" RENAME TO "DebateRound";
CREATE TABLE "new_Episode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "debateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "remotionManifest" JSONB,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "maxLlmCalls" INTEGER NOT NULL DEFAULT 25,
    "maxSearchQueries" INTEGER NOT NULL DEFAULT 5,
    "maxTtsSegments" INTEGER NOT NULL DEFAULT 40,
    "maxRevisionAttempts" INTEGER NOT NULL DEFAULT 3,
    CONSTRAINT "Episode_debateId_fkey" FOREIGN KEY ("debateId") REFERENCES "Debate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Episode" ("createdAt", "debateId", "id", "maxLlmCalls", "maxRevisionAttempts", "maxSearchQueries", "maxTtsSegments", "remotionManifest", "status", "title", "updatedAt") SELECT "createdAt", "debateId", "id", "maxLlmCalls", "maxRevisionAttempts", "maxSearchQueries", "maxTtsSegments", "remotionManifest", "status", "title", "updatedAt" FROM "Episode";
DROP TABLE "Episode";
ALTER TABLE "new_Episode" RENAME TO "Episode";
CREATE UNIQUE INDEX "Episode_debateId_key" ON "Episode"("debateId");
CREATE TABLE "new_EpisodeCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "episodeId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "debateRoundId" TEXT,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EpisodeCheckpoint_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EpisodeCheckpoint_debateRoundId_fkey" FOREIGN KEY ("debateRoundId") REFERENCES "DebateRound" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_EpisodeCheckpoint" ("createdAt", "episodeId", "fromState", "id", "reason", "snapshot") SELECT "createdAt", "episodeId", "fromState", "id", "reason", "snapshot" FROM "EpisodeCheckpoint";
DROP TABLE "EpisodeCheckpoint";
ALTER TABLE "new_EpisodeCheckpoint" RENAME TO "EpisodeCheckpoint";
CREATE TABLE "new_Topic" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Topic" ("context", "createdAt", "id", "title", "updatedAt") SELECT "context", "createdAt", "id", "title", "updatedAt" FROM "Topic";
DROP TABLE "Topic";
ALTER TABLE "new_Topic" RENAME TO "Topic";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
