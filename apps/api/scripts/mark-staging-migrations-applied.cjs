#!/usr/bin/env node
// Records the checked-in incremental migrations as represented by the
// freshly synchronized staging schema. This is only used by the gated,
// one-time bootstrap for an empty staging database.
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const migrationsDir = path.resolve(__dirname, '../prisma/migrations');

async function main() {
  const names = fs.readdirSync(migrationsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  await prisma.$transaction(async tx => {
    for (const name of names) {
      const sql = fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'));
      const checksum = createHash('sha256').update(sql).digest('hex');
      await tx.$executeRaw`INSERT INTO "_prisma_migrations"
        ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
        SELECT ${randomUUID()}, ${checksum}, NOW(), ${name}, NULL, NULL, NOW(), 0
        WHERE NOT EXISTS (
          SELECT 1 FROM "_prisma_migrations"
          WHERE "migration_name" = ${name}
            AND "finished_at" IS NOT NULL
            AND "rolled_back_at" IS NULL
        )`;
    }
  });
  process.stdout.write(`Recorded ${names.length} staging migration baselines.\\n`);
}

main()
  .catch(error => {
    console.error('Unable to record staging migration baselines:', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
