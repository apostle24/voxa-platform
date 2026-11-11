ALTER TABLE "User" ADD COLUMN "suspendedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "suspensionReason" TEXT;

CREATE INDEX "User_suspendedUntil_idx" ON "User"("suspendedUntil");
