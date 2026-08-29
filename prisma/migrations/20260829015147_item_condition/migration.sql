-- CreateEnum
CREATE TYPE "item_condition" AS ENUM ('brand_new', 'used');

-- AlterTable
ALTER TABLE "auction_items" ADD COLUMN     "condition" "item_condition";
