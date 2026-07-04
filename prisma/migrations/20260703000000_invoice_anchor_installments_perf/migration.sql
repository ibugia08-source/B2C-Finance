-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "accountCardId" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "historyMatched" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "installmentGroupKey" TEXT,
ADD COLUMN     "installmentNumber" INTEGER,
ADD COLUMN     "installmentTotal" INTEGER;

-- AlterTable
ALTER TABLE "CreditCardInvoice" ADD COLUMN     "declaredTotal" DOUBLE PRECISION,
ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "invoiceId" TEXT,
ADD COLUMN     "referenceMonth" INTEGER,
ADD COLUMN     "referenceYear" INTEGER;

-- CreateIndex
CREATE INDEX "Transaction_invoiceId_idx" ON "Transaction"("invoiceId");

-- CreateIndex
CREATE INDEX "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX "Transaction_installmentGroupKey_idx" ON "Transaction"("installmentGroupKey");

-- CreateIndex
CREATE INDEX "Transaction_accountCardId_idx" ON "Transaction"("accountCardId");

-- CreateIndex
CREATE INDEX "Installment_transactionId_idx" ON "Installment"("transactionId");

-- CreateIndex
CREATE INDEX "Installment_paid_dueDate_idx" ON "Installment"("paid", "dueDate");

-- CreateIndex
CREATE INDEX "Installment_invoiceId_idx" ON "Installment"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditCardInvoice_status_idx" ON "CreditCardInvoice"("status");

-- CreateIndex
CREATE INDEX "CreditCardInvoice_dueDate_idx" ON "CreditCardInvoice"("dueDate");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountCardId_fkey" FOREIGN KEY ("accountCardId") REFERENCES "AccountCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

