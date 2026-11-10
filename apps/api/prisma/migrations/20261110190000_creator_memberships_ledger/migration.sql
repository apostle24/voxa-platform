CREATE TYPE "MembershipInterval" AS ENUM ('MONTH');
CREATE TYPE "MembershipSubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');
CREATE TYPE "LedgerAccountType" AS ENUM ('CREATOR_AVAILABLE', 'CREATOR_PENDING', 'PLATFORM_CLEARING');
CREATE TYPE "LedgerEntryDirection" AS ENUM ('DEBIT', 'CREDIT');

ALTER TABLE "Episode" ADD COLUMN "membershipRequired" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "MembershipPlan" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "priceMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "interval" "MembershipInterval" NOT NULL DEFAULT 'MONTH',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MembershipPlan_creatorId_isActive_createdAt_idx" ON "MembershipPlan"("creatorId", "isActive", "createdAt");
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MembershipSubscription" (
  "id" TEXT NOT NULL,
  "subscriberId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "priceMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" "MembershipSubscriptionStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT,
  "providerSubscriptionId" TEXT,
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MembershipSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MembershipSubscription_providerSubscriptionId_key" ON "MembershipSubscription"("providerSubscriptionId");
CREATE UNIQUE INDEX "MembershipSubscription_subscriberId_creatorId_key" ON "MembershipSubscription"("subscriberId", "creatorId");
CREATE INDEX "MembershipSubscription_creatorId_status_currentPeriodEnd_idx" ON "MembershipSubscription"("creatorId", "status", "currentPeriodEnd");
CREATE INDEX "MembershipSubscription_subscriberId_status_currentPeriodEnd_idx" ON "MembershipSubscription"("subscriberId", "status", "currentPeriodEnd");
ALTER TABLE "MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MembershipSubscription" ADD CONSTRAINT "MembershipSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "LedgerAccount" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT,
  "type" "LedgerAccountType" NOT NULL,
  "currency" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerAccount_ownerId_type_currency_key" ON "LedgerAccount"("ownerId", "type", "currency");
CREATE INDEX "LedgerAccount_ownerId_currency_idx" ON "LedgerAccount"("ownerId", "currency");
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "LedgerTransaction" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'POSTED',
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");
CREATE INDEX "LedgerTransaction_type_createdAt_idx" ON "LedgerTransaction"("type", "createdAt");
CREATE INDEX "LedgerTransaction_reference_idx" ON "LedgerTransaction"("reference");

CREATE TABLE "LedgerEntry" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "direction" "LedgerEntryDirection" NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LedgerEntry_transactionId_accountId_direction_key" ON "LedgerEntry"("transactionId", "accountId", "direction");
CREATE INDEX "LedgerEntry_accountId_createdAt_idx" ON "LedgerEntry"("accountId", "createdAt");
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
