-- CreateEnum
CREATE TYPE "UpsellStatus" AS ENUM ('OPPORTUNITY', 'NEGOTIATION', 'WON', 'LOST', 'PAUSED');

-- AlterTable (recorrência de despesa + competência de fatura de cartão)
ALTER TABLE "Transaction" ADD COLUMN     "recurrenceGroupId" TEXT,
ADD COLUMN     "recurrenceInterval" INTEGER,
ADD COLUMN     "cardInvoiceMonth" INTEGER,
ADD COLUMN     "cardInvoiceYear" INTEGER;

-- CreateTable
CREATE TABLE "Upsell" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceId" TEXT,
    "offerId" TEXT,
    "title" TEXT,
    "value" DECIMAL(14,2) NOT NULL,
    "responsible" TEXT,
    "status" "UpsellStatus" NOT NULL DEFAULT 'OPPORTUNITY',
    "expectedCloseAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "incomeId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Upsell_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Transaction_recurrenceGroupId_idx" ON "Transaction"("recurrenceGroupId");

-- CreateIndex
CREATE INDEX "Upsell_clientId_idx" ON "Upsell"("clientId");

-- CreateIndex
CREATE INDEX "Upsell_status_idx" ON "Upsell"("status");

-- CreateIndex
CREATE INDEX "Upsell_expectedCloseAt_idx" ON "Upsell"("expectedCloseAt");

-- CreateIndex
CREATE INDEX "Upsell_ownerId_idx" ON "Upsell"("ownerId");

-- AddForeignKey
ALTER TABLE "Upsell" ADD CONSTRAINT "Upsell_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upsell" ADD CONSTRAINT "Upsell_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upsell" ADD CONSTRAINT "Upsell_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upsell" ADD CONSTRAINT "Upsell_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
