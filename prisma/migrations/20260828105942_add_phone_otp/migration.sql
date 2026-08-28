-- CreateTable
CREATE TABLE "verified_phones" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verified_phones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_otp_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "refno" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_otp_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verified_phones_userId_idx" ON "verified_phones"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "verified_phones_userId_phone_key" ON "verified_phones"("userId", "phone");

-- CreateIndex
CREATE INDEX "phone_otp_requests_userId_phone_createdAt_idx" ON "phone_otp_requests"("userId", "phone", "createdAt");

-- CreateIndex
CREATE INDEX "phone_otp_requests_phone_createdAt_idx" ON "phone_otp_requests"("phone", "createdAt");

-- AddForeignKey
ALTER TABLE "verified_phones" ADD CONSTRAINT "verified_phones_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_otp_requests" ADD CONSTRAINT "phone_otp_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
