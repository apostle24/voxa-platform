ALTER TABLE "MediaAsset"
  ADD COLUMN "processingAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processingStartedAt" TIMESTAMP(3);
