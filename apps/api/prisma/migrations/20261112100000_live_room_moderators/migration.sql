CREATE TABLE "LiveRoomModerator" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveRoomModerator_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LiveRoomModerator_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LiveRoomModerator_roomId_userId_key" ON "LiveRoomModerator"("roomId", "userId");
CREATE INDEX "LiveRoomModerator_userId_assignedAt_idx" ON "LiveRoomModerator"("userId", "assignedAt");
