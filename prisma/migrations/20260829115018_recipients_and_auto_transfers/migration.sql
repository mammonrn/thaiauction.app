-- CreateEnum
CREATE TYPE "recipient_status" AS ENUM ('pending', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "transfer_status" AS ENUM ('pending', 'sent', 'paid', 'failed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type" ADD VALUE 'bank_verified';
ALTER TYPE "notification_type" ADD VALUE 'bank_rejected';
ALTER TYPE "notification_type" ADD VALUE 'payout_sent';

-- AlterTable
ALTER TABLE "bank_account_changes" ADD COLUMN     "previousOmiseRecipientId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "omiseTransferId" TEXT,
ADD COLUMN     "transferAmount" INTEGER,
ADD COLUMN     "transferFailureCode" TEXT,
ADD COLUMN     "transferFailureMessage" TEXT,
ADD COLUMN     "transferFee" INTEGER,
ADD COLUMN     "transferNet" INTEGER,
ADD COLUMN     "transferPaidAt" TIMESTAMP(3),
ADD COLUMN     "transferSentAt" TIMESTAMP(3),
ADD COLUMN     "transferStatus" "transfer_status";

-- AlterTable
ALTER TABLE "seller_bank_accounts" ADD COLUMN     "omiseRecipientId" TEXT,
ADD COLUMN     "recipientCheckedAt" TIMESTAMP(3),
ADD COLUMN     "recipientCreatedAt" TIMESTAMP(3),
ADD COLUMN     "recipientFailureCode" TEXT,
ADD COLUMN     "recipientStatus" "recipient_status" NOT NULL DEFAULT 'pending',
ADD COLUMN     "recipientVerifiedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "payments_omiseTransferId_key" ON "payments"("omiseTransferId");

-- CreateIndex
CREATE INDEX "payments_transferStatus_transferSentAt_idx" ON "payments"("transferStatus", "transferSentAt");

-- CreateIndex
CREATE UNIQUE INDEX "seller_bank_accounts_omiseRecipientId_key" ON "seller_bank_accounts"("omiseRecipientId");

-- CreateIndex
CREATE INDEX "seller_bank_accounts_recipientStatus_recipientCheckedAt_idx" ON "seller_bank_accounts"("recipientStatus", "recipientCheckedAt");


-- One live transfer per auction, enforced by PostgreSQL rather than by an
-- application check — the same guarantee, and for the same reason, as
-- "payments_one_successful_per_auction" above it.
--
-- The application claims the slot with a conditional UPDATE before it calls
-- Omise, which is what makes a double-click a no-op. This index is what makes
-- it SAFE: two admins on two connections can both pass an application-level
-- "has this been transferred?" check, and the loser gets a unique violation
-- instead of a second transfer of the same money.
--
-- 'failed' is deliberately outside the index. A transfer Omise refused is not
-- money that moved, so the auction goes back in the queue and the next attempt
-- can claim the slot again.
CREATE UNIQUE INDEX "payments_one_live_transfer_per_auction"
  ON "payments" ("auctionItemId")
  WHERE "transferStatus" IN ('pending', 'sent', 'paid');
