CREATE TABLE "FinancialAuditLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancialAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FinancialAuditLog_actorUserId_createdAt_idx" ON "FinancialAuditLog"("actorUserId", "createdAt");
CREATE INDEX "FinancialAuditLog_entityType_entityId_createdAt_idx" ON "FinancialAuditLog"("entityType", "entityId", "createdAt");
