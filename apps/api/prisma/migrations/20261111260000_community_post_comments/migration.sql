CREATE TABLE "CommunityPostComment" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommunityPostComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommunityPostComment_postId_createdAt_idx" ON "CommunityPostComment"("postId", "createdAt");
CREATE INDEX "CommunityPostComment_authorId_createdAt_idx" ON "CommunityPostComment"("authorId", "createdAt");

ALTER TABLE "CommunityPostComment"
ADD CONSTRAINT "CommunityPostComment_postId_fkey"
FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityPostComment"
ADD CONSTRAINT "CommunityPostComment_authorId_fkey"
FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
