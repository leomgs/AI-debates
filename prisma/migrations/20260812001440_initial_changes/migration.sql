/*
  Warnings:

  - You are about to drop the column `audioDuration` on the `Argument` table. All the data in the column will be lost.
  - You are about to drop the column `audioUrl` on the `Argument` table. All the data in the column will be lost.
  - Added the required column `contentHash` to the `Source` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "EvidenceFact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceFact_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArgumentHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "argumentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArgumentHistory_argumentId_fkey" FOREIGN KEY ("argumentId") REFERENCES "Argument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EpisodeUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "episodeId" TEXT NOT NULL,
    "llmCalls" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "searchRequests" INTEGER NOT NULL DEFAULT 0,
    "ttsRequests" INTEGER NOT NULL DEFAULT 0,
    "executionTime" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EpisodeUsage_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EpisodeCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "episodeId" TEXT NOT NULL,
    "fromState" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EpisodeCheckpoint_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AudioAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storageKey" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "_FactCheckToSource" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_FactCheckToSource_A_fkey" FOREIGN KEY ("A") REFERENCES "FactCheck" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "_FactCheckToSource_B_fkey" FOREIGN KEY ("B") REFERENCES "Source" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Argument_debateRoundId_fkey" FOREIGN KEY ("debateRoundId") REFERENCES "DebateRound" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Argument_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Argument_audioAssetId_fkey" FOREIGN KEY ("audioAssetId") REFERENCES "AudioAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Argument" ("agentId", "content", "createdAt", "debateRoundId", "id") SELECT "agentId", "content", "createdAt", "debateRoundId", "id" FROM "Argument";
DROP TABLE "Argument";
ALTER TABLE "new_Argument" RENAME TO "Argument";
CREATE UNIQUE INDEX "Argument_audioAssetId_key" ON "Argument"("audioAssetId");
CREATE TABLE "new_Claim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "argumentId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FACTUAL',
    CONSTRAINT "Claim_argumentId_fkey" FOREIGN KEY ("argumentId") REFERENCES "Argument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Claim" ("argumentId", "id", "statement") SELECT "argumentId", "id", "statement" FROM "Claim";
DROP TABLE "Claim";
ALTER TABLE "new_Claim" RENAME TO "Claim";
CREATE TABLE "new_Episode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "debateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "remotionManifest" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "maxLlmCalls" INTEGER NOT NULL DEFAULT 25,
    "maxSearchQueries" INTEGER NOT NULL DEFAULT 5,
    "maxTtsSegments" INTEGER NOT NULL DEFAULT 40,
    "maxRevisionAttempts" INTEGER NOT NULL DEFAULT 3,
    CONSTRAINT "Episode_debateId_fkey" FOREIGN KEY ("debateId") REFERENCES "Debate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Episode" ("createdAt", "debateId", "id", "remotionManifest", "status", "title", "updatedAt") SELECT "createdAt", "debateId", "id", "remotionManifest", "status", "title", "updatedAt" FROM "Episode";
DROP TABLE "Episode";
ALTER TABLE "new_Episode" RENAME TO "Episode";
CREATE UNIQUE INDEX "Episode_debateId_key" ON "Episode"("debateId");
CREATE TABLE "new_Source" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "researchSessionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "fetchTimestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" DATETIME,
    "contentHash" TEXT NOT NULL,
    CONSTRAINT "Source_researchSessionId_fkey" FOREIGN KEY ("researchSessionId") REFERENCES "ResearchSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Source" ("id", "researchSessionId", "snippet", "title", "url") SELECT "id", "researchSessionId", "snippet", "title", "url" FROM "Source";
DROP TABLE "Source";
ALTER TABLE "new_Source" RENAME TO "Source";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeUsage_episodeId_key" ON "EpisodeUsage"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeCheckpoint_episodeId_key" ON "EpisodeCheckpoint"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "_FactCheckToSource_AB_unique" ON "_FactCheckToSource"("A", "B");

-- CreateIndex
CREATE INDEX "_FactCheckToSource_B_index" ON "_FactCheckToSource"("B");
