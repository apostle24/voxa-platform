CREATE TYPE "ReportTargetType" AS ENUM ('EPISODE', 'MOMENT', 'LIVE_ROOM', 'USER');
CREATE TYPE "ReportReason" AS ENUM ('HARASSMENT', 'HATE', 'VIOLENCE', 'SEXUAL_CONTENT', 'SPAM', 'COPYRIGHT', 'SELF_HARM', 'OTHER');
CREATE TYPE "ReportStatus" AS ENUM ('NEW', 'REVIEWING', 'ACTIONED', 'DISMISSED');

CREATE TABLE "ContentReport" (
  "id" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "targetType" "ReportTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" "ReportReason" NOT NULL,
  "details" TEXT,
  "status" "ReportStatus" NOT NULL DEFAULT 'NEW',
  "reviewerId" TEXT,
  "moderatorNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContentReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContentReport_status_createdAt_idx" ON "ContentReport"("status", "createdAt");
CREATE INDEX "ContentReport_targetType_targetId_createdAt_idx" ON "ContentReport"("targetType", "targetId", "createdAt");
CREATE INDEX "ContentReport_reporterId_createdAt_idx" ON "ContentReport"("reporterId", "createdAt");

ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentReport" ADD CONSTRAINT "ContentReport_reviewerId_fkey"
  FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
