-- CreateEnum
CREATE TYPE "ExtraRevenueType" AS ENUM ('RECOVERY_OF_OVERDUE', 'MANUAL_EXTRA_REVENUE', 'ONE_TIME_SERVICE', 'ADJUSTMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExtraRevenueOrigin" AS ENUM ('AUTOMATIC', 'MANUAL');

-- AlterTable (fechamento mensal)
ALTER TABLE "Billing" ADD COLUMN     "isLate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paidInDifferentMonth" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ExtraRevenue" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "originBillingId" TEXT,
    "sourcePaymentId" TEXT,
    "type" "ExtraRevenueType" NOT NULL DEFAULT 'RECOVERY_OF_OVERDUE',
    "origin" "ExtraRevenueOrigin" NOT NULL DEFAULT 'AUTOMATIC',
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "originalReferenceMonth" INTEGER,
    "originalReferenceYear" INTEGER,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtraRevenue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtraRevenue_originBillingId_key" ON "ExtraRevenue"("originBillingId");

-- CreateIndex
CREATE INDEX "ExtraRevenue_clientId_idx" ON "ExtraRevenue"("clientId");

-- CreateIndex
CREATE INDEX "ExtraRevenue_receivedAt_idx" ON "ExtraRevenue"("receivedAt");

-- CreateIndex
CREATE INDEX "ExtraRevenue_type_idx" ON "ExtraRevenue"("type");

-- CreateIndex
CREATE INDEX "ExtraRevenue_ownerId_idx" ON "ExtraRevenue"("ownerId");

-- AddForeignKey
ALTER TABLE "ExtraRevenue" ADD CONSTRAINT "ExtraRevenue_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraRevenue" ADD CONSTRAINT "ExtraRevenue_originBillingId_fkey" FOREIGN KEY ("originBillingId") REFERENCES "Billing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExtraRevenue" ADD CONSTRAINT "ExtraRevenue_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
