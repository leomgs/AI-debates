-- Spec 003, API-19 (D17): archivo de los veredictos que reemplaza la acción
-- regenerate-verdict (DebateService.replaceVerdict). Aditiva: solo CREATE
-- TABLE, no toca filas existentes. Sin FK a Agent para judgeId/winnerId (es
-- un archivo; ver schema.prisma y tasks.md §13.4). Escrita a mano y aplicada
-- con `prisma migrate deploy` (decision-log.md #21). Segunda de la cola de
-- migraciones de la F2: después de add_episode_published_at (API-7a) y antes
-- de la del idioma (spec 004, tasks.md §13.4).

-- CreateTable
CREATE TABLE "VerdictHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "debateId" TEXT NOT NULL,
    "judgeId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "winnerId" TEXT,
    "issuedAt" DATETIME NOT NULL,
    "supersededAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerdictHistory_debateId_fkey" FOREIGN KEY ("debateId") REFERENCES "Debate" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
