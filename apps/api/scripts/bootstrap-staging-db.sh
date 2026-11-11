#!/bin/sh
# One-time staging bootstrap for databases created before the repository had a
# baseline migration. This is deliberately gated and must not be enabled in
# production. The current Prisma schema is the source of truth for this empty
# staging database; the existing incremental migration history is then marked
# as already represented by that schema.
set -eu

if [ "${VOXA_STAGING_DB_BOOTSTRAP:-false}" = "true" ]; then
  echo "VOXA staging database bootstrap enabled"

  # The first incremental migration failed because the empty database has no
  # pre-existing Episode table. Resolve that failed attempt before schema push.
  if output=$(pnpm --filter @voxa/api exec prisma migrate resolve --rolled-back 20261110160000_media_asset_processing 2>&1); then
    printf '%s\n' "$output"
  else
    printf '%s\n' "$output"
    # P3012 means the migration is already resolved and is not in a failed state.
    printf '%s\n' "$output" | grep -q 'P3012' || exit 1
  fi

  # The staging database is new and contains no user data. Do not use
  # --accept-data-loss: unexpected destructive changes should stop startup.
  pnpm --filter @voxa/api exec prisma db push
  # Recreate custom partial unique indexes that Prisma schema DSL cannot express.
  pnpm --filter @voxa/api exec prisma db execute --schema prisma/schema.prisma --file prisma/staging-bootstrap.sql

  # Record all migration checksums in one transaction. The current Prisma
  # schema and the custom indexes above now represent this fresh database.
  node apps/api/scripts/mark-staging-migrations-applied.cjs
  echo "VOXA staging database schema bootstrap complete"
else
  pnpm --filter @voxa/api exec prisma migrate deploy
fi
