-- CreateEnum
CREATE TYPE "ClientModality" AS ENUM ('MRR', 'TCV');

-- CreateEnum
CREATE TYPE "DelinquencyStatus" AS ENUM ('PAGO', 'DEVENDO');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "modality" "ClientModality",
ADD COLUMN     "renewalMonth" INTEGER,
ADD COLUMN     "delinquencyOverride" "DelinquencyStatus",
ADD COLUMN     "delinquencyOverrideMonth" INTEGER,
ADD COLUMN     "delinquencyOverrideYear" INTEGER,
ADD COLUMN     "delinquencyOverrideAt" TIMESTAMP(3),
ADD COLUMN     "delinquencyOverrideBy" TEXT;

-- CreateIndex
CREATE INDEX "Client_modality_idx" ON "Client"("modality");

-- CreateIndex
CREATE INDEX "Client_renewalMonth_idx" ON "Client"("renewalMonth");
