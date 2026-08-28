-- CreateEnum
CREATE TYPE "auction_status" AS ENUM ('draft', 'active', 'ended', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "addressLine" TEXT NOT NULL,
    "subDistrict" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_items" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "images" TEXT[],
    "startPrice" INTEGER NOT NULL,
    "currentPrice" INTEGER NOT NULL,
    "buyNowPrice" INTEGER,
    "endTime" TIMESTAMP(3),
    "status" "auction_status" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" TEXT NOT NULL,
    "auctionItemId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "shipping_addresses_userId_isDefault_idx" ON "shipping_addresses"("userId", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "auction_items_status_endTime_idx" ON "auction_items"("status", "endTime");

-- CreateIndex
CREATE INDEX "auction_items_categoryId_status_idx" ON "auction_items"("categoryId", "status");

-- CreateIndex
CREATE INDEX "auction_items_sellerId_idx" ON "auction_items"("sellerId");

-- CreateIndex
CREATE INDEX "bids_auctionItemId_amount_idx" ON "bids"("auctionItemId", "amount" DESC);

-- CreateIndex
CREATE INDEX "bids_bidderId_idx" ON "bids"("bidderId");

-- CreateIndex
CREATE UNIQUE INDEX "bids_auctionItemId_amount_key" ON "bids"("auctionItemId", "amount");

-- AddForeignKey
ALTER TABLE "shipping_addresses" ADD CONSTRAINT "shipping_addresses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_items" ADD CONSTRAINT "auction_items_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_items" ADD CONSTRAINT "auction_items_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_auctionItemId_fkey" FOREIGN KEY ("auctionItemId") REFERENCES "auction_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
