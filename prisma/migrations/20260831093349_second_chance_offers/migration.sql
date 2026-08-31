-- CreateEnum
CREATE TYPE "second_chance_status" AS ENUM ('offered', 'accepted', 'declined', 'expired');

-- CreateTable
CREATE TABLE "second_chance_offers" (
    "id" TEXT NOT NULL,
    "auctionItemId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "second_chance_status" NOT NULL DEFAULT 'offered',
    "liveForItemId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "second_chance_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "second_chance_offers_liveForItemId_key" ON "second_chance_offers"("liveForItemId");

-- CreateIndex
CREATE INDEX "second_chance_offers_auctionItemId_createdAt_idx" ON "second_chance_offers"("auctionItemId", "createdAt");

-- CreateIndex
CREATE INDEX "second_chance_offers_bidderId_status_idx" ON "second_chance_offers"("bidderId", "status");

-- CreateIndex
CREATE INDEX "second_chance_offers_status_expiresAt_idx" ON "second_chance_offers"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "second_chance_offers" ADD CONSTRAINT "second_chance_offers_auctionItemId_fkey" FOREIGN KEY ("auctionItemId") REFERENCES "auction_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "second_chance_offers" ADD CONSTRAINT "second_chance_offers_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

