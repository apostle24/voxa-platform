CREATE TABLE "EpisodeComment" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EpisodeComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EpisodeLike" (
    "userId" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EpisodeLike_pkey" PRIMARY KEY ("userId", "episodeId")
);

CREATE INDEX "EpisodeComment_episodeId_createdAt_idx" ON "EpisodeComment"("episodeId", "createdAt");
CREATE INDEX "EpisodeComment_parentId_createdAt_idx" ON "EpisodeComment"("parentId", "createdAt");
CREATE INDEX "EpisodeComment_authorId_createdAt_idx" ON "EpisodeComment"("authorId", "createdAt");
CREATE INDEX "EpisodeLike_episodeId_createdAt_idx" ON "EpisodeLike"("episodeId", "createdAt");

ALTER TABLE "EpisodeComment" ADD CONSTRAINT "EpisodeComment_episodeId_fkey"
  FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EpisodeComment" ADD CONSTRAINT "EpisodeComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EpisodeComment" ADD CONSTRAINT "EpisodeComment_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "EpisodeComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EpisodeLike" ADD CONSTRAINT "EpisodeLike_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EpisodeLike" ADD CONSTRAINT "EpisodeLike_episodeId_fkey"
  FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
