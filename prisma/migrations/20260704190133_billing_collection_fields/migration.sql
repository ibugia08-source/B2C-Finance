-- AlterTable
ALTER TABLE "Billing" ADD COLUMN     "collector" TEXT,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "serviceId" TEXT;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

