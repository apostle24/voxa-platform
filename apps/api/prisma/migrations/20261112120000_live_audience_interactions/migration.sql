CREATE TABLE "LivePoll" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "LivePoll_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LivePollOption" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  CONSTRAINT "LivePollOption_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LivePollVote" (
  "id" TEXT NOT NULL,
  "pollId" TEXT NOT NULL,
  "optionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LivePollVote_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "LiveQuestion" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "isPinned" BOOLEAN NOT NULL DEFAULT false,
  "answer" TEXT,
  "answeredBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LiveQuestion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LivePollVote_pollId_userId_key" ON "LivePollVote"("pollId", "userId");
CREATE INDEX "LivePoll_roomId_createdAt_idx" ON "LivePoll"("roomId", "createdAt");
CREATE INDEX "LivePollOption_pollId_idx" ON "LivePollOption"("pollId");
CREATE INDEX "LivePollVote_optionId_idx" ON "LivePollVote"("optionId");
CREATE INDEX "LiveQuestion_roomId_status_isPinned_createdAt_idx" ON "LiveQuestion"("roomId", "status", "isPinned", "createdAt");
CREATE INDEX "LiveQuestion_userId_createdAt_idx" ON "LiveQuestion"("userId", "createdAt");
ALTER TABLE "LivePoll" ADD CONSTRAINT "LivePoll_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LivePollOption" ADD CONSTRAINT "LivePollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "LivePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LivePollVote" ADD CONSTRAINT "LivePollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "LivePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LivePollVote" ADD CONSTRAINT "LivePollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "LivePollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveQuestion" ADD CONSTRAINT "LiveQuestion_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "LiveRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveQuestion" ADD CONSTRAINT "LiveQuestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LivePollVote" ADD CONSTRAINT "LivePollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
