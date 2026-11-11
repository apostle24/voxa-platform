ALTER TABLE "CommunityPost" ADD COLUMN "deletedAt" TIMESTAMP(3);
CREATE INDEX "CommunityPost_deletedAt_idx" ON "CommunityPost"("deletedAt");
