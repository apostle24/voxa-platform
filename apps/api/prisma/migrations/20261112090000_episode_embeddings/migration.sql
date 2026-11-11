CREATE TABLE "EpisodeEmbedding" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "vector" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EpisodeEmbedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EpisodeEmbedding_episodeId_key" ON "EpisodeEmbedding"("episodeId");
CREATE INDEX "EpisodeEmbedding_updatedAt_idx" ON "EpisodeEmbedding"("updatedAt");

ALTER TABLE "EpisodeEmbedding"
ADD CONSTRAINT "EpisodeEmbedding_episodeId_fkey"
FOREIGN KEY ("episodeId") REFERENCES "Episode"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
