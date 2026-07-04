-- DropIndex
DROP INDEX "Person_name_key";

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "CreditCard" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "AccountCard" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Installment" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "CreditCardInvoice" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Receivable" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "CashBox" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "PersonPayment" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "CashBoxMovement" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "CategorizationRule" ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Person_ownerId_idx" ON "Person"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_ownerId_name_key" ON "Person"("ownerId", "name");

-- CreateIndex
CREATE INDEX "Account_ownerId_idx" ON "Account"("ownerId");

-- CreateIndex
CREATE INDEX "CreditCard_ownerId_idx" ON "CreditCard"("ownerId");

-- CreateIndex
CREATE INDEX "AccountCard_ownerId_idx" ON "AccountCard"("ownerId");

-- CreateIndex
CREATE INDEX "Transaction_ownerId_idx" ON "Transaction"("ownerId");

-- CreateIndex
CREATE INDEX "Installment_ownerId_idx" ON "Installment"("ownerId");

-- CreateIndex
CREATE INDEX "CreditCardInvoice_ownerId_idx" ON "CreditCardInvoice"("ownerId");

-- CreateIndex
CREATE INDEX "Receivable_ownerId_idx" ON "Receivable"("ownerId");

-- CreateIndex
CREATE INDEX "Income_ownerId_idx" ON "Income"("ownerId");

-- CreateIndex
CREATE INDEX "CashBox_ownerId_idx" ON "CashBox"("ownerId");

-- CreateIndex
CREATE INDEX "PersonPayment_ownerId_idx" ON "PersonPayment"("ownerId");

-- CreateIndex
CREATE INDEX "CashBoxMovement_ownerId_idx" ON "CashBoxMovement"("ownerId");

-- CreateIndex
CREATE INDEX "Goal_ownerId_idx" ON "Goal"("ownerId");

-- CreateIndex
CREATE INDEX "ImportBatch_ownerId_idx" ON "ImportBatch"("ownerId");

-- CreateIndex
CREATE INDEX "CategorizationRule_ownerId_idx" ON "CategorizationRule"("ownerId");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditCard" ADD CONSTRAINT "CreditCard_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCard" ADD CONSTRAINT "AccountCard_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditCardInvoice" ADD CONSTRAINT "CreditCardInvoice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receivable" ADD CONSTRAINT "Receivable_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Income" ADD CONSTRAINT "Income_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashBox" ADD CONSTRAINT "CashBox_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonPayment" ADD CONSTRAINT "PersonPayment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashBoxMovement" ADD CONSTRAINT "CashBoxMovement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategorizationRule" ADD CONSTRAINT "CategorizationRule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

