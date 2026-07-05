-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "competenceMonth" INTEGER,
ADD COLUMN     "competenceYear" INTEGER;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "recurrence" "RecurrenceType",
ADD COLUMN     "serviceId" TEXT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

