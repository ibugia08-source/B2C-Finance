-- =====================================================================
-- F0.3 — DINHEIRO EM Decimal(14,2) (ref. 01 §3.14)
--
-- Converte os 16 campos monetários que ainda eram double precision. Float
-- não representa centavos: as somas do banco acusavam 418386.42999999993
-- e 355429.87000000017 antes desta migration.
--
-- Arredondamento: o cast double→numeric(14,2) do PostgreSQL arredonda para
-- o mais próximo (empate para longe do zero) = half-up da especificação.
-- A conferência soma-antes/soma-depois roda em scripts/verify-decimal-backfill.mjs.
--
-- AISetting.temperature continua Float de propósito: não é dinheiro.
--
-- ATENÇÃO A QUEM GERAR A PRÓXIMA MIGRATION: o `prisma migrate dev` propôs
-- aqui um `DROP INDEX "User_workspaceOwnerId_idx"` — índice criado por SQL
-- cru em 20260723210000 e invisível ao schema.prisma. Foi REMOVIDO deste
-- arquivo. O mesmo vale para "Billing_client_competence_mrr_key"
-- (20260813215806). Sempre stripar esses DROPs.
-- =====================================================================

/*
  Warnings:

  - You are about to alter the column `balance` on the `Account` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `limit` on the `AccountCard` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `currentAmount` on the `CashBox` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `targetAmount` on the `CashBox` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `amount` on the `CashBoxMovement` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `amountGreaterThan` on the `CategorizationRule` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `amountLessThan` on the `CategorizationRule` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `limitTotal` on the `CreditCard` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `total` on the `CreditCardInvoice` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `paid` on the `CreditCardInvoice` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `declaredTotal` on the `CreditCardInvoice` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `amount` on the `Income` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `amount` on the `Installment` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `amount` on the `PersonPayment` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `amount` on the `Receivable` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.
  - You are about to alter the column `amount` on the `Transaction` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.

*/
-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "balance" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "AccountCard" ALTER COLUMN "limit" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "CashBox" ALTER COLUMN "currentAmount" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "targetAmount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "CashBoxMovement" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "CategorizationRule" ALTER COLUMN "amountGreaterThan" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "amountLessThan" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "CreditCard" ALTER COLUMN "limitTotal" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "CreditCardInvoice" ALTER COLUMN "total" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "paid" SET DATA TYPE DECIMAL(14,2),
ALTER COLUMN "declaredTotal" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Income" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Installment" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "PersonPayment" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Receivable" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(14,2);
