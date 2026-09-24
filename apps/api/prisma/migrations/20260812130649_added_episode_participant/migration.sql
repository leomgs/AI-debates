-- CreateTable
CREATE TABLE "EpisodeParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "episodeId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "modelProvider" TEXT NOT NULL,
    "isJudge" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "EpisodeParticipant_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EpisodeParticipant_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "openingRounds" INTEGER NOT NULL DEFAULT 1,
    "rebuttalRounds" INTEGER NOT NULL DEFAULT 1,
    "crossExaminationRounds" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "Episode_debateId_fkey" FOREIGN KEY ("debateId") REFERENCES "Debate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Episode" ("createdAt", "debateId", "id", "maxLlmCalls", "maxRevisionAttempts", "maxSearchQueries", "maxTtsSegments", "remotionManifest", "status", "title", "updatedAt") SELECT "createdAt", "debateId", "id", "maxLlmCalls", "maxRevisionAttempts", "maxSearchQueries", "maxTtsSegments", "remotionManifest", "status", "title", "updatedAt" FROM "Episode";
DROP TABLE "Episode";
ALTER TABLE "new_Episode" RENAME TO "Episode";
CREATE UNIQUE INDEX "Episode_debateId_key" ON "Episode"("debateId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeParticipant_episodeId_agentId_key" ON "EpisodeParticipant"("episodeId", "agentId");
