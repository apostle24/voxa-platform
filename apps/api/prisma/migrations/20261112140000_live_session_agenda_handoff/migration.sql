CREATE TABLE "LiveAgendaItem" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "durationSeconds" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveAgendaItem_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LiveSpeakerTurn" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "speakerId" TEXT NOT NULL,
  "agendaItemId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "LiveSpeakerTurn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LiveAgendaItem_roomId_position_key" ON "LiveAgendaItem"("roomId", "position");
CREATE INDEX "LiveAgendaItem_roomId_status_position_idx" ON "LiveAgendaItem"("roomId", "status", "position");
CREATE INDEX "LiveSpeakerTurn_roomId_status_startedAt_idx" ON "LiveSpeakerTurn"("roomId", "status", "startedAt");
CREATE INDEX "LiveSpeakerTurn_speakerId_startedAt_idx" ON "LiveSpeakerTurn"("speakerId", "startedAt");
ALTER TABLE "LiveAgendaItem" ADD CONSTRAINT "LiveAgendaItem_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSpeakerTurn" ADD CONSTRAINT "LiveSpeakerTurn_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSpeakerTurn" ADD CONSTRAINT "LiveSpeakerTurn_speakerId_fkey" FOREIGN KEY ("speakerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveSpeakerTurn" ADD CONSTRAINT "LiveSpeakerTurn_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "LiveAgendaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
