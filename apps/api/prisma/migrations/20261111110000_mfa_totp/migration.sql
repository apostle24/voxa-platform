CREATE TABLE "MfaCredential" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "encryptedSecret" TEXT NOT NULL,
  "enabledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MfaCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MfaCredential_userId_key" ON "MfaCredential"("userId");
ALTER TABLE "MfaCredential" ADD CONSTRAINT "MfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MfaBackupCode" (
  "id" TEXT NOT NULL,
  "credentialId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaBackupCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MfaBackupCode_codeHash_key" ON "MfaBackupCode"("codeHash");
CREATE INDEX "MfaBackupCode_credentialId_consumedAt_idx" ON "MfaBackupCode"("credentialId", "consumedAt");
ALTER TABLE "MfaBackupCode" ADD CONSTRAINT "MfaBackupCode_credentialId_fkey" FOREIGN KEY ("credentialId") REFERENCES "MfaCredential"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MfaLoginChallenge" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MfaLoginChallenge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MfaLoginChallenge_tokenHash_key" ON "MfaLoginChallenge"("tokenHash");
CREATE INDEX "MfaLoginChallenge_userId_expiresAt_consumedAt_idx" ON "MfaLoginChallenge"("userId", "expiresAt", "consumedAt");
ALTER TABLE "MfaLoginChallenge" ADD CONSTRAINT "MfaLoginChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
