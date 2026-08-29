-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "payment_method" ADD VALUE 'installment';
ALTER TYPE "payment_method" ADD VALUE 'shopeepay';

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "authorizeUri" TEXT,
ADD COLUMN     "installmentBank" TEXT,
ADD COLUMN     "installmentTerm" INTEGER,
ADD COLUMN     "interest" INTEGER,
ADD COLUMN     "interestVat" INTEGER;
