-- CreateEnum
CREATE TYPE "seller_verification_status" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "seller_verifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "seller_verification_status" NOT NULL DEFAULT 'pending',
    "documentKey" TEXT,
    "documentDeletedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "seller_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seller_verifications_status_submittedAt_idx" ON "seller_verifications"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "seller_verifications_userId_submittedAt_idx" ON "seller_verifications"("userId", "submittedAt");

-- AddForeignKey
ALTER TABLE "seller_verifications" ADD CONSTRAINT "seller_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_verifications" ADD CONSTRAINT "seller_verifications_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
