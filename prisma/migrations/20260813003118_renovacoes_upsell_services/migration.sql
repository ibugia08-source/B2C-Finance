-- AlterTable
ALTER TABLE "Upsell" ADD COLUMN     "billingId" TEXT;

-- CreateTable
CREATE TABLE "ClientRenewal" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contractId" TEXT,
    "renewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "months" INTEGER NOT NULL,
    "totalValue" DECIMAL(14,2) NOT NULL,
    "monthlyValue" DECIMAL(14,2),
    "modality" "ClientModality",
    "paymentMethod" TEXT,
    "paymentMode" TEXT,
    "previousEndDate" TIMESTAMP(3),
    "newEndDate" TIMESTAMP(3),
    "billingId" TEXT,
    "billingMonth" INTEGER,
    "billingYear" INTEGER,
    "keptMonthly" BOOLEAN,
    "paymentStatus" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpsellService" (
    "id" TEXT NOT NULL,
    "upsellId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpsellService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientRenewal_clientId_idx" ON "ClientRenewal"("clientId");

-- CreateIndex
CREATE INDEX "ClientRenewal_renewedAt_idx" ON "ClientRenewal"("renewedAt");

-- CreateIndex
CREATE INDEX "ClientRenewal_billingYear_billingMonth_idx" ON "ClientRenewal"("billingYear", "billingMonth");

-- CreateIndex
CREATE INDEX "ClientRenewal_ownerId_idx" ON "ClientRenewal"("ownerId");

-- CreateIndex
CREATE INDEX "UpsellService_upsellId_idx" ON "UpsellService"("upsellId");

-- CreateIndex
CREATE INDEX "UpsellService_serviceId_idx" ON "UpsellService"("serviceId");

-- CreateIndex
CREATE INDEX "UpsellService_ownerId_idx" ON "UpsellService"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "UpsellService_upsellId_serviceId_key" ON "UpsellService"("upsellId", "serviceId");

-- AddForeignKey
ALTER TABLE "ClientRenewal" ADD CONSTRAINT "ClientRenewal_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRenewal" ADD CONSTRAINT "ClientRenewal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellService" ADD CONSTRAINT "UpsellService_upsellId_fkey" FOREIGN KEY ("upsellId") REFERENCES "Upsell"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellService" ADD CONSTRAINT "UpsellService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpsellService" ADD CONSTRAINT "UpsellService_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
