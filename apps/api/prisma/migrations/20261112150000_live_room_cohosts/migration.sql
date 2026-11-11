CREATE TABLE "LiveRoomCoHost" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignedById" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveRoomCoHost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveRoomCoHost_roomId_userId_key" ON "LiveRoomCoHost"("roomId", "userId");
CREATE INDEX "LiveRoomCoHost_userId_assignedAt_idx" ON "LiveRoomCoHost"("userId", "assignedAt");

ALTER TABLE "LiveRoomCoHost" ADD CONSTRAINT "LiveRoomCoHost_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveRoomCoHost" ADD CONSTRAINT "LiveRoomCoHost_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveRoomCoHost" ADD CONSTRAINT "LiveRoomCoHost_assignedById_fkey"
  FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
