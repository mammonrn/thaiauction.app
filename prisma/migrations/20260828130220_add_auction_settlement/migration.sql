-- CreateEnum
CREATE TYPE "auction_end_reason" AS ENUM ('expired', 'buy_now', 'seller_ended', 'seller_cancelled');

-- AlterTable
ALTER TABLE "auction_items" ADD COLUMN     "endReason" "auction_end_reason",
ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "winnerId" TEXT;

-- CreateIndex
CREATE INDEX "auction_items_winnerId_idx" ON "auction_items"("winnerId");

-- AddForeignKey
ALTER TABLE "auction_items" ADD CONSTRAINT "auction_items_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
