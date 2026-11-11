CREATE TABLE "LiveGuestInvitation" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "inviteeId" TEXT NOT NULL,
  "inviterId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "slotStartsAt" TIMESTAMP(3) NOT NULL,
  "slotEndsAt" TIMESTAMP(3) NOT NULL,
  "message" TEXT,
  "respondedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveGuestInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LiveGuestInvitation_roomId_inviteeId_key" ON "LiveGuestInvitation"("roomId", "inviteeId");
CREATE INDEX "LiveGuestInvitation_inviteeId_status_slotStartsAt_idx" ON "LiveGuestInvitation"("inviteeId", "status", "slotStartsAt");
CREATE INDEX "LiveGuestInvitation_roomId_status_slotStartsAt_idx" ON "LiveGuestInvitation"("roomId", "status", "slotStartsAt");

ALTER TABLE "LiveGuestInvitation" ADD CONSTRAINT "LiveGuestInvitation_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveGuestInvitation" ADD CONSTRAINT "LiveGuestInvitation_inviteeId_fkey"
  FOREIGN KEY ("inviteeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveGuestInvitation" ADD CONSTRAINT "LiveGuestInvitation_inviterId_fkey"
  FOREIGN KEY ("inviterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
