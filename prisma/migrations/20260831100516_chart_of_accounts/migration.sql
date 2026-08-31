-- =====================================================================
-- F0.6 — PLANO DE CONTAS GERENCIAL-CONTÁBIL (ref. 03 §2.2)
--
-- Cria a estrutura de contas com NATUREZA (accountType, normalBalance,
-- statementType, isPostingAccount). É ela que impede empréstimo, fatura de
-- cartão e transferência de virarem despesa duplicada, e que faz a DRE somar
-- só statementType = PNL.
--
-- O SEED das contas e o de-para das categorias do v1 rodam em
-- prisma/seed-chart-of-accounts.ts (fonte única em prisma/chart-of-accounts.ts),
-- para que a árvore e a conferência vivam em código testável, não em SQL solto.
--
-- Lembrete recorrente: DROP INDEX de "User_workspaceOwnerId_idx" (SQL cru)
-- removido daqui de novo.
-- =====================================================================

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "NormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "StatementType" AS ENUM ('BALANCE_SHEET', 'PNL');

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "accountId" TEXT;

-- CreateTable
CREATE TABLE "AccountingAccount" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "parentId" TEXT,
    "accountType" "AccountType" NOT NULL,
    "normalBalance" "NormalBalance" NOT NULL,
    "statementType" "StatementType" NOT NULL,
    "isPostingAccount" BOOLEAN NOT NULL DEFAULT true,
    "isUnclassified" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AccountingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountingAccount_workspaceId_idx" ON "AccountingAccount"("workspaceId");

-- CreateIndex
CREATE INDEX "AccountingAccount_workspaceId_statementType_idx" ON "AccountingAccount"("workspaceId", "statementType");

-- CreateIndex
CREATE INDEX "AccountingAccount_workspaceId_accountType_idx" ON "AccountingAccount"("workspaceId", "accountType");

-- CreateIndex
CREATE INDEX "AccountingAccount_active_idx" ON "AccountingAccount"("active");

-- CreateIndex
CREATE UNIQUE INDEX "AccountingAccount_workspaceId_code_key" ON "AccountingAccount"("workspaceId", "code");

-- AddForeignKey
ALTER TABLE "AccountingAccount" ADD CONSTRAINT "AccountingAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountingAccount" ADD CONSTRAINT "AccountingAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
