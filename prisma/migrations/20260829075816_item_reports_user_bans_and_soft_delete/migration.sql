-- CreateEnum
CREATE TYPE "report_reason" AS ENUM ('illegal', 'counterfeit', 'inappropriate', 'other');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('open', 'dismissed', 'actioned');

-- CreateEnum
CREATE TYPE "ban_kind" AS ENUM ('login', 'bidding');

-- AlterTable
ALTER TABLE "auction_items" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "deletedReason" TEXT;

-- CreateTable
CREATE TABLE "item_reports" (
    "id" TEXT NOT NULL,
    "auctionItemId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "report_reason" NOT NULL,
    "note" TEXT,
    "status" "report_status" NOT NULL DEFAULT 'open',
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "item_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_bans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ban_kind" NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "liftedAt" TIMESTAMP(3),
    "bannedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_bans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "item_reports_status_createdAt_idx" ON "item_reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "item_reports_auctionItemId_idx" ON "item_reports"("auctionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "item_reports_auctionItemId_reporterId_key" ON "item_reports"("auctionItemId", "reporterId");

-- CreateIndex
CREATE INDEX "user_bans_userId_kind_expiresAt_idx" ON "user_bans"("userId", "kind", "expiresAt");

-- CreateIndex
CREATE INDEX "user_bans_userId_createdAt_idx" ON "user_bans"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "auction_items_deletedAt_status_idx" ON "auction_items"("deletedAt", "status");

-- AddForeignKey
ALTER TABLE "auction_items" ADD CONSTRAINT "auction_items_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_reports" ADD CONSTRAINT "item_reports_auctionItemId_fkey" FOREIGN KEY ("auctionItemId") REFERENCES "auction_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_reports" ADD CONSTRAINT "item_reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_reports" ADD CONSTRAINT "item_reports_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_bans" ADD CONSTRAINT "user_bans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_bans" ADD CONSTRAINT "user_bans_bannedById_fkey" FOREIGN KEY ("bannedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
