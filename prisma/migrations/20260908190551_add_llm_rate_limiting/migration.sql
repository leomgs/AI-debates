-- CreateTable
CREATE TABLE "LlmRequestLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "LlmRequestLog_provider_requestedAt_idx" ON "LlmRequestLog"("provider", "requestedAt");
