-- CreateEnum
CREATE TYPE "OfferModality" AS ENUM ('MRR', 'TCV', 'CUSTOM');

-- CreateTable
CREATE TABLE "ClientLoss" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "lostAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modality" "ClientModality",
    "monthlyValue" DECIMAL(14,2),
    "referenceValue" DECIMAL(14,2),
    "reason" TEXT,
    "salesOwner" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientLoss_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "modality" "OfferModality" NOT NULL DEFAULT 'MRR',
    "defaultValue" DECIMAL(14,2),
    "durationMonths" INTEGER,
    "paymentMethod" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferService" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientLoss_clientId_idx" ON "ClientLoss"("clientId");

-- CreateIndex
CREATE INDEX "ClientLoss_lostAt_idx" ON "ClientLoss"("lostAt");

-- CreateIndex
CREATE INDEX "ClientLoss_ownerId_idx" ON "ClientLoss"("ownerId");

-- CreateIndex
CREATE INDEX "Offer_active_idx" ON "Offer"("active");

-- CreateIndex
CREATE INDEX "Offer_modality_idx" ON "Offer"("modality");

-- CreateIndex
CREATE INDEX "Offer_ownerId_idx" ON "Offer"("ownerId");

-- CreateIndex
CREATE INDEX "OfferService_offerId_idx" ON "OfferService"("offerId");

-- CreateIndex
CREATE INDEX "OfferService_serviceId_idx" ON "OfferService"("serviceId");

-- CreateIndex
CREATE INDEX "OfferService_ownerId_idx" ON "OfferService"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferService_offerId_serviceId_key" ON "OfferService"("offerId", "serviceId");

-- AddForeignKey
ALTER TABLE "ClientLoss" ADD CONSTRAINT "ClientLoss_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLoss" ADD CONSTRAINT "ClientLoss_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferService" ADD CONSTRAINT "OfferService_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferService" ADD CONSTRAINT "OfferService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferService" ADD CONSTRAINT "OfferService_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
