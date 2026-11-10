#!/usr/bin/env node
'use strict';

// Run manually from the API package after setting DATABASE_URL,
// VOXA_BOOTSTRAP_ADMIN_EMAIL, and VOXA_BOOTSTRAP_ADMIN_PASSWORD.
// This is intentionally not exposed as an HTTP endpoint.
const { PrismaClient, UserRole } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const email = process.env.VOXA_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.VOXA_BOOTSTRAP_ADMIN_PASSWORD;

  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('VOXA_BOOTSTRAP_ADMIN_EMAIL must be a valid email address');
  }
  if (!password || password.length < 14) {
    throw new Error('VOXA_BOOTSTRAP_ADMIN_PASSWORD must contain at least 14 characters');
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      throw new Error('That email already exists. This bootstrap only creates the first admin and never promotes or overwrites an existing account.');
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: 'VOXA Administrator',
        role: UserRole.ADMIN,
      },
      select: { id: true, email: true, role: true },
    });
    process.stdout.write('Created initial VOXA administrator: ' + admin.email + ' (' + admin.id + ')\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(error => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
});
