CREATE TABLE "EpisodeChapter" (
  "id" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "startSeconds" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EpisodeChapter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EpisodeChapter_episodeId_startSeconds_key" ON "EpisodeChapter"("episodeId", "startSeconds");
CREATE INDEX "EpisodeChapter_episodeId_position_idx" ON "EpisodeChapter"("episodeId", "position");
ALTER TABLE "EpisodeChapter" ADD CONSTRAINT "EpisodeChapter_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
