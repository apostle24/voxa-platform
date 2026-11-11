CREATE TABLE "EpisodeTranscript" (
  "id" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'en',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EpisodeTranscript_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EpisodeTranscript_episodeId_key" ON "EpisodeTranscript"("episodeId");
ALTER TABLE "EpisodeTranscript" ADD CONSTRAINT "EpisodeTranscript_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
