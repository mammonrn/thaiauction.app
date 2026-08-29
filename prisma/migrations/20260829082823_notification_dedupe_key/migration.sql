-- DropIndex
DROP INDEX "notifications_userId_type_createdAt_idx";

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "dedupeKey" TEXT;

-- CreateIndex
CREATE INDEX "notifications_userId_dedupeKey_idx" ON "notifications"("userId", "dedupeKey");
