CREATE TABLE "EpisodeIntelligence" (
  "id" TEXT NOT NULL,
  "episodeId" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "topics" JSONB NOT NULL,
  "model" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EpisodeIntelligence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EpisodeIntelligence_episodeId_key" ON "EpisodeIntelligence"("episodeId");
ALTER TABLE "EpisodeIntelligence" ADD CONSTRAINT "EpisodeIntelligence_episodeId_fkey"
FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
