CREATE TABLE "MomentLike" (
  "userId" TEXT NOT NULL,
  "momentId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MomentLike_pkey" PRIMARY KEY ("userId", "momentId")
);
CREATE INDEX "MomentLike_momentId_createdAt_idx" ON "MomentLike"("momentId", "createdAt");
ALTER TABLE "MomentLike" ADD CONSTRAINT "MomentLike_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MomentLike" ADD CONSTRAINT "MomentLike_momentId_fkey"
  FOREIGN KEY ("momentId") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MomentComment" (
  "id" TEXT NOT NULL,
  "momentId" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "parentId" TEXT,
  "content" TEXT NOT NULL,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MomentComment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MomentComment_momentId_createdAt_idx" ON "MomentComment"("momentId", "createdAt");
CREATE INDEX "MomentComment_parentId_createdAt_idx" ON "MomentComment"("parentId", "createdAt");
CREATE INDEX "MomentComment_authorId_createdAt_idx" ON "MomentComment"("authorId", "createdAt");
ALTER TABLE "MomentComment" ADD CONSTRAINT "MomentComment_momentId_fkey"
  FOREIGN KEY ("momentId") REFERENCES "Moment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MomentComment" ADD CONSTRAINT "MomentComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MomentComment" ADD CONSTRAINT "MomentComment_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "MomentComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
