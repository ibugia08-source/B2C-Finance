-- CreateEnum
CREATE TYPE "ContractTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GeneratedContractStatus" AS ENUM ('GENERATED', 'SENT', 'SIGNED', 'CANCELED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ContractCommercialType" AS ENUM ('MRR', 'TCV', 'ONE_TIME', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BillingModel" AS ENUM ('MONTHLY', 'UPFRONT', 'INSTALLMENTS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ContractDurationType" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ClientDocumentType" AS ENUM ('CONTRACT', 'PROPOSAL', 'RECEIPT', 'BRIEFING', 'LEGAL_DOCUMENT', 'OTHER');

-- CreateTable
CREATE TABLE "ContractTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "commercialType" "ContractCommercialType",
    "billingModel" "BillingModel",
    "durationType" "ContractDurationType",
    "durationMonths" INTEGER,
    "monthlyAmount" DECIMAL(14,2),
    "totalAmount" DECIMAL(14,2),
    "defaultDueDay" INTEGER,
    "includedServices" JSONB,
    "internalNotes" TEXT,
    "originalFileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "fileHash" TEXT,
    "variables" JSONB NOT NULL,
    "warnings" JSONB,
    "status" "ContractTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedContract" (
    "id" TEXT NOT NULL,
    "templateId" TEXT,
    "clientId" TEXT,
    "name" TEXT NOT NULL,
    "commercialType" "ContractCommercialType",
    "amount" DECIMAL(14,2),
    "startDate" TIMESTAMP(3),
    "dueDay" INTEGER,
    "filledVariables" JSONB NOT NULL,
    "generatedFileName" TEXT NOT NULL,
    "generatedFilePath" TEXT NOT NULL,
    "status" "GeneratedContractStatus" NOT NULL DEFAULT 'GENERATED',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "documentType" "ClientDocumentType" NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientNote" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractTemplate_ownerId_idx" ON "ContractTemplate"("ownerId");

-- CreateIndex
CREATE INDEX "ContractTemplate_status_idx" ON "ContractTemplate"("status");

-- CreateIndex
CREATE INDEX "GeneratedContract_templateId_idx" ON "GeneratedContract"("templateId");

-- CreateIndex
CREATE INDEX "GeneratedContract_clientId_idx" ON "GeneratedContract"("clientId");

-- CreateIndex
CREATE INDEX "GeneratedContract_ownerId_idx" ON "GeneratedContract"("ownerId");

-- CreateIndex
CREATE INDEX "GeneratedContract_status_idx" ON "GeneratedContract"("status");

-- CreateIndex
CREATE INDEX "ClientDocument_clientId_idx" ON "ClientDocument"("clientId");

-- CreateIndex
CREATE INDEX "ClientDocument_ownerId_idx" ON "ClientDocument"("ownerId");

-- CreateIndex
CREATE INDEX "ClientNote_clientId_idx" ON "ClientNote"("clientId");

-- CreateIndex
CREATE INDEX "ClientNote_ownerId_idx" ON "ClientNote"("ownerId");

-- AddForeignKey
ALTER TABLE "ContractTemplate" ADD CONSTRAINT "ContractTemplate_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedContract" ADD CONSTRAINT "GeneratedContract_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContractTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedContract" ADD CONSTRAINT "GeneratedContract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedContract" ADD CONSTRAINT "GeneratedContract_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

