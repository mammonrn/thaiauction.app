-- CreateEnum
CREATE TYPE "shipping_status" AS ENUM ('not_shipped', 'shipped');

-- AlterTable
ALTER TABLE "auction_items" ADD COLUMN     "shipToDistrict" TEXT,
ADD COLUMN     "shipToLine" TEXT,
ADD COLUMN     "shipToName" TEXT,
ADD COLUMN     "shipToPhone" TEXT,
ADD COLUMN     "shipToPostalCode" TEXT,
ADD COLUMN     "shipToProvince" TEXT,
ADD COLUMN     "shipToSubDistrict" TEXT,
ADD COLUMN     "shippingStatus" "shipping_status" NOT NULL DEFAULT 'not_shipped',
ADD COLUMN     "trackingNumber" TEXT;
