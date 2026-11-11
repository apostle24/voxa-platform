ALTER TABLE "LiveRoom"
  ADD COLUMN "recordingStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "recordingEgressId" TEXT,
  ADD COLUMN "recordingObjectKey" TEXT,
  ADD COLUMN "recordingConsentAt" TIMESTAMP(3),
  ADD COLUMN "recordingStartedAt" TIMESTAMP(3),
  ADD COLUMN "recordingEndedAt" TIMESTAMP(3),
  ADD COLUMN "recordingFailure" TEXT;

CREATE UNIQUE INDEX "LiveRoom_recordingEgressId_key" ON "LiveRoom"("recordingEgressId");
