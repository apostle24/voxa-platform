CREATE TABLE "LiveRoomHostTransfer" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "previousHostId" TEXT NOT NULL,
  "newHostId" TEXT NOT NULL,
  "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveRoomHostTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LiveRoomHostTransfer_roomId_transferredAt_idx" ON "LiveRoomHostTransfer"("roomId", "transferredAt");
CREATE INDEX "LiveRoomHostTransfer_previousHostId_transferredAt_idx" ON "LiveRoomHostTransfer"("previousHostId", "transferredAt");
CREATE INDEX "LiveRoomHostTransfer_newHostId_transferredAt_idx" ON "LiveRoomHostTransfer"("newHostId", "transferredAt");

ALTER TABLE "LiveRoomHostTransfer" ADD CONSTRAINT "LiveRoomHostTransfer_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveRoomHostTransfer" ADD CONSTRAINT "LiveRoomHostTransfer_previousHostId_fkey"
  FOREIGN KEY ("previousHostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LiveRoomHostTransfer" ADD CONSTRAINT "LiveRoomHostTransfer_newHostId_fkey"
  FOREIGN KEY ("newHostId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
