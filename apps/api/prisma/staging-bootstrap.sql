-- Custom partial unique indexes from the original incremental migrations.
-- Prisma db push cannot represent partial predicates in the schema DSL.
CREATE UNIQUE INDEX IF NOT EXISTS "CreatorPayoutDestination_one_default_per_creator_key"
  ON "CreatorPayoutDestination" ("creatorId")
  WHERE "isDefault" = true;

CREATE UNIQUE INDEX IF NOT EXISTS "LivePoll_one_open_per_room_key"
  ON "LivePoll" ("roomId")
  WHERE "status" = 'OPEN';
