CREATE TABLE "MomentRender" (
  "id" TEXT NOT NULL,
  "momentId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "aspectRatio" TEXT NOT NULL DEFAULT '9:16',
  "subtitles" JSONB,
  "playbackKey" TEXT,
  "contentType" TEXT,
  "sizeBytes" BIGINT,
  "failureReason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "MomentRender_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MomentRender_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "MomentRender_status_createdAt_idx" ON "MomentRender"("status", "createdAt");
CREATE INDEX "MomentRender_momentId_createdAt_idx" ON "MomentRender"("momentId", "createdAt");
