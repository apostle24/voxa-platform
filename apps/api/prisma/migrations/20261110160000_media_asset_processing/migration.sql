CREATE TYPE "MediaProcessingStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PROCESSING', 'READY', 'FAILED');

CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "status" "MediaProcessingStatus" NOT NULL DEFAULT 'UPLOADED',
  "durationSeconds" INTEGER,
  "width" INTEGER,
  "height" INTEGER,
  "playbackKey" TEXT,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaAsset_objectKey_key" ON "MediaAsset"("objectKey");
CREATE INDEX "MediaAsset_episodeId_createdAt_idx" ON "MediaAsset"("episodeId", "createdAt");
CREATE INDEX "MediaAsset_status_createdAt_idx" ON "MediaAsset"("status", "createdAt");

ALTER TABLE "MediaAsset"
ADD CONSTRAINT "MediaAsset_episodeId_fkey"
FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
