-- CreateEnum
CREATE TYPE "otp_purpose" AS ENUM ('verify_phone', 'bank_change', 'password_reset');

-- DropIndex
DROP INDEX "phone_otp_requests_userId_phone_createdAt_idx";

-- AlterTable
ALTER TABLE "phone_otp_requests" ADD COLUMN     "purpose" "otp_purpose" NOT NULL DEFAULT 'verify_phone';

-- AlterTable
ALTER TABLE "seller_bank_accounts" ADD COLUMN     "unlockedByPhone" TEXT,
ADD COLUMN     "unlockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "bank_account_changes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "previousBankCode" TEXT NOT NULL,
    "previousAccountNumber" TEXT NOT NULL,
    "previousAccountName" TEXT NOT NULL,
    "newBankCode" TEXT NOT NULL,
    "newAccountNumber" TEXT NOT NULL,
    "newAccountName" TEXT NOT NULL,
    "newNameMatchesKyc" BOOLEAN NOT NULL,
    "authorisedByPhone" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_account_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_requests" (
    "id" TEXT NOT NULL,
    "emailHash" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_account_changes_userId_changedAt_idx" ON "bank_account_changes"("userId", "changedAt");

-- CreateIndex
CREATE INDEX "password_reset_requests_emailHash_createdAt_idx" ON "password_reset_requests"("emailHash", "createdAt");

-- CreateIndex
CREATE INDEX "password_reset_requests_ipAddress_createdAt_idx" ON "password_reset_requests"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX "phone_otp_requests_userId_phone_purpose_createdAt_idx" ON "phone_otp_requests"("userId", "phone", "purpose", "createdAt");

-- AddForeignKey
ALTER TABLE "bank_account_changes" ADD CONSTRAINT "bank_account_changes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "seller_bank_accounts"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
