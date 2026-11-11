CREATE TABLE "LiveKitWebhookEvent" (
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "roomId" TEXT,
  "participantIdentity" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LiveKitWebhookEvent_pkey" PRIMARY KEY ("eventId")
);

CREATE INDEX "LiveKitWebhookEvent_roomId_eventType_receivedAt_idx"
ON "LiveKitWebhookEvent"("roomId", "eventType", "receivedAt");

CREATE INDEX "LiveKitWebhookEvent_participantIdentity_receivedAt_idx"
ON "LiveKitWebhookEvent"("participantIdentity", "receivedAt");
