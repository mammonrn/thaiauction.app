-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'successful', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('card', 'promptpay');

-- CreateEnum
CREATE TYPE "auction_payment_state" AS ENUM ('not_applicable', 'awaiting_payment', 'paid', 'unpaid');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('pending', 'transferred');

-- AlterTable
ALTER TABLE "auction_items" ADD COLUMN     "paymentDueAt" TIMESTAMP(3),
ADD COLUMN     "paymentState" "auction_payment_state" NOT NULL DEFAULT 'not_applicable';

-- AlterTable
ALTER TABLE "bids" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "auctionItemId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "method" "payment_method" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "omiseChargeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "fee" INTEGER,
    "feeVat" INTEGER,
    "net" INTEGER,
    "commission" INTEGER,
    "sellerNet" INTEGER,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "qrDownloadUri" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "payoutStatus" "payout_status" NOT NULL DEFAULT 'pending',
    "payoutAt" TIMESTAMP(3),
    "payoutReference" TEXT,
    "payoutById" TEXT,
    "payoutAccountNumber" TEXT,
    "payoutAccountName" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_strikes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "auctionItemId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_strikes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_bank_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountName" TEXT NOT NULL,
    "nameMatchesKyc" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seller_bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_omiseChargeId_key" ON "payments"("omiseChargeId");

-- CreateIndex
CREATE INDEX "payments_status_payoutStatus_idx" ON "payments"("status", "payoutStatus");

-- CreateIndex
CREATE INDEX "payments_auctionItemId_createdAt_idx" ON "payments"("auctionItemId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_payerId_createdAt_idx" ON "payments"("payerId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_strikes_userId_createdAt_idx" ON "payment_strikes"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_strikes_userId_auctionItemId_key" ON "payment_strikes"("userId", "auctionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "seller_bank_accounts_userId_key" ON "seller_bank_accounts"("userId");

-- CreateIndex
CREATE INDEX "auction_items_paymentState_paymentDueAt_idx" ON "auction_items"("paymentState", "paymentDueAt");

-- CreateIndex
CREATE INDEX "bids_ipAddress_createdAt_idx" ON "bids"("ipAddress", "createdAt");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_auctionItemId_fkey" FOREIGN KEY ("auctionItemId") REFERENCES "auction_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payoutById_fkey" FOREIGN KEY ("payoutById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_strikes" ADD CONSTRAINT "payment_strikes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_strikes" ADD CONSTRAINT "payment_strikes_auctionItemId_fkey" FOREIGN KEY ("auctionItemId") REFERENCES "auction_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_bank_accounts" ADD CONSTRAINT "seller_bank_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Idempotency, enforced by PostgreSQL rather than by application checks.
--
-- Prisma cannot express a partial unique index, so these are written by hand.
-- They are the real guarantee that a buyer cannot be charged twice for one
-- auction: two concurrent requests that both pass an application-level "has
-- this been paid?" check will still collide here, and the loser gets a unique
-- violation instead of creating a second charge.
--
-- At most one SUCCESSFUL payment per auction, ever.
CREATE UNIQUE INDEX "payments_one_successful_per_auction"
  ON "payments" ("auctionItemId")
  WHERE "status" = 'successful';

-- At most one PENDING attempt per auction at a time. Omise's expire endpoint
-- does not cover PromptPay, so a QR that has been handed out cannot be recalled
-- — the only safe way to stop a buyer paying twice is to refuse to open a
-- second attempt until the first one resolves. PromptPay charges are created
-- with a short expires_at so "resolves" never means "waits forever".
CREATE UNIQUE INDEX "payments_one_pending_per_auction"
  ON "payments" ("auctionItemId")
  WHERE "status" = 'pending';
