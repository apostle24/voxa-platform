WITH ranked_open_polls AS (
  SELECT "id",
         ROW_NUMBER() OVER (PARTITION BY "roomId" ORDER BY "createdAt" DESC, "id" DESC) AS position
  FROM "LivePoll"
  WHERE "status" = 'OPEN'
)
UPDATE "LivePoll"
SET "status" = 'CLOSED',
    "closedAt" = COALESCE("closedAt", CURRENT_TIMESTAMP)
WHERE "id" IN (SELECT "id" FROM ranked_open_polls WHERE position > 1);

CREATE UNIQUE INDEX "LivePoll_one_open_per_room_key"
ON "LivePoll" ("roomId")
WHERE "status" = 'OPEN';
