CREATE TABLE "Moment" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "caption" TEXT NOT NULL,
  "startSeconds" INTEGER NOT NULL,
  "endSeconds" INTEGER NOT NULL,
  "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Moment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Moment_status_publishedAt_idx" ON "Moment"("status", "publishedAt");
CREATE INDEX "Moment_creatorId_createdAt_idx" ON "Moment"("creatorId", "createdAt");
CREATE INDEX "Moment_episodeId_status_idx" ON "Moment"("episodeId", "status");
ALTER TABLE "Moment" ADD CONSTRAINT "Moment_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Moment" ADD CONSTRAINT "Moment_episodeId_fkey"
  FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
