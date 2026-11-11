CREATE TABLE "LiveChatMessage" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LiveChatMessage_roomId_createdAt_idx" ON "LiveChatMessage"("roomId", "createdAt");
CREATE INDEX "LiveChatMessage_userId_createdAt_idx" ON "LiveChatMessage"("userId", "createdAt");
ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveChatMessage" ADD CONSTRAINT "LiveChatMessage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
