ALTER TABLE "LiveRoom" ADD COLUMN "peakAudienceCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "LiveViewerSession" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "LiveViewerSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveViewerSession_roomId_sessionId_key" ON "LiveViewerSession"("roomId", "sessionId");
CREATE INDEX "LiveViewerSession_roomId_leftAt_lastSeenAt_idx" ON "LiveViewerSession"("roomId", "leftAt", "lastSeenAt");
CREATE INDEX "LiveViewerSession_roomId_userId_leftAt_idx" ON "LiveViewerSession"("roomId", "userId", "leftAt");

ALTER TABLE "LiveViewerSession" ADD CONSTRAINT "LiveViewerSession_roomId_fkey"
FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
