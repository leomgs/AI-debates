-- Spec 003, API-7a: Episode.publishedAt (nullable, null hasta que exista
-- la acción publish de API-7). Aditiva: no toca filas existentes, todas
-- quedan en NULL (no publicadas). Escrita a mano y aplicada con
-- `prisma migrate deploy` (decision-log.md #21).

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN "publishedAt" DATETIME;
