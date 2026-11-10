ALTER TYPE "LedgerAccountType" ADD VALUE 'PLATFORM_REVENUE';
ALTER TYPE "LedgerAccountType" ADD VALUE 'PROVIDER_FEE_EXPENSE';
CREATE TYPE "PayoutRequestStatus" AS ENUM (
  'REQUESTED', 'UNDER_REVIEW', 'APPROVED', 'SUBMITTED',
  'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'
);

ALTER TABLE "PaymentAttempt"
  ADD COLUMN "platformFeeBps" INTEGER NOT NULL DEFAULT 1500,
  ADD COLUMN "platformFeeMinor" INTEGER,
  ADD COLUMN "creatorNetMinor" INTEGER,
  ADD COLUMN "providerFeeMinor" INTEGER,
  ADD COLUMN "providerFeeRecordedAt" TIMESTAMP(3);

UPDATE "PaymentAttempt"
SET "platformFeeMinor" = ROUND("amountMinor" * 0.15)::INTEGER,
    "creatorNetMinor" = "amountMinor" - ROUND("amountMinor" * 0.15)::INTEGER;

ALTER TABLE "PaymentAttempt"
  ALTER COLUMN "platformFeeMinor" SET NOT NULL,
  ALTER COLUMN "creatorNetMinor" SET NOT NULL;

CREATE TABLE "CreatorPayoutDestination" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerRecipientCode" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "maskedAccountNumber" TEXT NOT NULL,
  "isVerified" BOOLEAN NOT NULL DEFAULT false,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreatorPayoutDestination_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CreatorPayoutDestination_providerRecipientCode_key"
  ON "CreatorPayoutDestination"("providerRecipientCode");
CREATE INDEX "CreatorPayoutDestination_creatorId_isDefault_createdAt_idx"
  ON "CreatorPayoutDestination"("creatorId", "isDefault", "createdAt");
ALTER TABLE "CreatorPayoutDestination"
  ADD CONSTRAINT "CreatorPayoutDestination_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "PayoutRequest" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "destinationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "PayoutRequestStatus" NOT NULL DEFAULT 'REQUESTED',
  "providerTransferCode" TEXT,
  "failureReason" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PayoutRequest_reference_key" ON "PayoutRequest"("reference");
CREATE UNIQUE INDEX "PayoutRequest_idempotencyKey_key" ON "PayoutRequest"("idempotencyKey");
CREATE UNIQUE INDEX "PayoutRequest_providerTransferCode_key" ON "PayoutRequest"("providerTransferCode");
CREATE INDEX "PayoutRequest_creatorId_status_requestedAt_idx"
  ON "PayoutRequest"("creatorId", "status", "requestedAt");
CREATE INDEX "PayoutRequest_provider_status_requestedAt_idx"
  ON "PayoutRequest"("provider", "status", "requestedAt");
ALTER TABLE "PayoutRequest"
  ADD CONSTRAINT "PayoutRequest_creatorId_fkey"
  FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "PayoutRequest_destinationId_fkey"
  FOREIGN KEY ("destinationId") REFERENCES "CreatorPayoutDestination"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
