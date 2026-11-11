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
    printf '%s\\n' "$output"
  else
    printf '%s\\n' "$output"
    # P3012 means the migration is already resolved and is not in a failed state.
    printf '%s\\n' "$output" | grep -q 'P3012' || exit 1
  fi

  # The staging database is new and contains no user data. Do not use
  # --accept-data-loss: unexpected destructive changes should stop startup.
  pnpm --filter @voxa/api exec prisma db push

  # The final Prisma schema now represents the complete current schema.
  # Record the repository's incremental migrations as represented by it.
  for migration_dir in apps/api/prisma/migrations/*; do
    [ -d "$migration_dir" ] || continue
    migration_name=$(basename "$migration_dir")
    if output=$(pnpm --filter @voxa/api exec prisma migrate resolve --applied "$migration_name" 2>&1); then
      printf '%s\n' "$output"
    else
      printf '%s\n' "$output"
      # On a restart after a successful bootstrap, already-applied migrations
      # are expected. Any other failure must stop the service.
      printf '%s\n' "$output" | grep -q 'P3008' || exit 1
    fi
  done
  echo "VOXA staging database schema bootstrap complete"
else
  pnpm --filter @voxa/api exec prisma migrate deploy
fi
