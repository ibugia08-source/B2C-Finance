-- =====================================================================
-- F0.4 — COMPETÊNCIA CANÔNICA E INSTANTES EM UTC (ref. 01 §3.15)
--
-- 1) TODA coluna DateTime vira timestamptz(3): o instante passa a ser
--    explícito, e SQL cru deixa de depender do fuso da sessão.
--
--    CRÍTICO: o `ALTER ... SET DATA TYPE TIMESTAMPTZ` sem `USING` interpreta
--    o valor antigo no fuso da SESSÃO. Os valores foram gravados pelo Prisma
--    em UTC, e o banco local roda em America/Bahia — sem a linha abaixo,
--    todos os instantes andariam 3 horas. O `SET LOCAL` vale só dentro da
--    transação desta migration.
--
-- 2) Coluna `competence` (YYYY-MM) ao lado dos pares mês/ano, com backfill,
--    índice e GATILHO: quem escreve a competência é o BANCO, a partir do par
--    mês/ano. App, script ou SQL cru — as duas colunas nunca divergem.
--
-- 3) Tabela Workspace com fuso/locale/moeda (01 §4.2), semeada com uma linha
--    para o dono atual.
--
-- Conferência: scripts/verify-timestamps.mjs compara a impressão digital dos
-- instantes antes e depois (precisa dar 0 divergências).
-- =====================================================================

SET LOCAL TIME ZONE 'UTC';

-- AlterTable
ALTER TABLE "AIConversation" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "AIMemory" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "AIMessage" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "AISetting" ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "AccountCard" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "AnnualTarget" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Asset" ALTER COLUMN "acquiredAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Billing" ADD COLUMN     "competence" TEXT,
ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "canceledAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "CashBox" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "CashBoxMovement" ALTER COLUMN "date" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "CategorizationRule" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Category" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Client" ALTER COLUMN "startedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "churnedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "delinquencyOverrideAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "archivedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "deletedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ClientContact" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ClientDocument" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ClientLoss" ALTER COLUMN "lostAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ClientMonthDelinquency" ADD COLUMN     "competence" TEXT,
ALTER COLUMN "setAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ClientNote" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ClientRenewal" ALTER COLUMN "renewedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "previousEndDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "newEndDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "CollectionHistory" ALTER COLUMN "contactedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "nextActionAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Commission" ADD COLUMN     "competence" TEXT,
ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Contract" ALTER COLUMN "startDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "endDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "renewalDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "canceledAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ContractFormLink" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ContractService" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ContractTemplate" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "CreditCard" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "CreditCardInvoice" ALTER COLUMN "closingDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "startedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "endedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ExportReport" ALTER COLUMN "generatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ExtraRevenue" ALTER COLUMN "receivedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "FinancialAlert" ALTER COLUMN "dueAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "readAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "resolvedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "GeneratedContract" ALTER COLUMN "startDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "generatedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ImportBatch" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "ImportTemplate" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Income" ADD COLUMN     "competence" TEXT,
ALTER COLUMN "receivedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "date" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Installment" ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Liability" ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Loan" ALTER COLUMN "firstDueDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Offer" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "OfferService" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Payroll" ADD COLUMN     "competence" TEXT,
ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "PayrollItem" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Person" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "PersonPayment" ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Receivable" ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "paidAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "RoutineItemState" ALTER COLUMN "routineDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "SavedView" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Service" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "date" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "dueDate" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Upsell" ALTER COLUMN "expectedCloseAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "closedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "UpsellService" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "lockedUntil" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "UserPermission" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Bahia',
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_ownerId_key" ON "Workspace"("ownerId");

-- CreateIndex
CREATE INDEX "Billing_competence_idx" ON "Billing"("competence");

-- CreateIndex
CREATE INDEX "Billing_ownerId_competence_idx" ON "Billing"("ownerId", "competence");

-- CreateIndex
CREATE INDEX "ClientMonthDelinquency_competence_idx" ON "ClientMonthDelinquency"("competence");

-- CreateIndex
CREATE INDEX "ClientMonthDelinquency_ownerId_competence_idx" ON "ClientMonthDelinquency"("ownerId", "competence");

-- CreateIndex
CREATE INDEX "Commission_competence_idx" ON "Commission"("competence");

-- CreateIndex
CREATE INDEX "Commission_ownerId_competence_idx" ON "Commission"("ownerId", "competence");

-- CreateIndex
CREATE INDEX "Income_competence_idx" ON "Income"("competence");

-- CreateIndex
CREATE INDEX "Income_ownerId_competence_idx" ON "Income"("ownerId", "competence");

-- CreateIndex
CREATE INDEX "Payroll_competence_idx" ON "Payroll"("competence");

-- CreateIndex
CREATE INDEX "Payroll_ownerId_competence_idx" ON "Payroll"("ownerId", "competence");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- COMPETÊNCIA: backfill + gatilho de sincronismo
-- =====================================================================

-- Função única: recebe os nomes das colunas de ano e mês (TG_ARGV) e escreve
-- a competência canônica. Lê o NEW por jsonb para servir às 5 tabelas, que
-- nomeiam o par de formas diferentes (competenceYear/Month e year/month).
CREATE OR REPLACE FUNCTION b2c_set_competence() RETURNS trigger AS $$
DECLARE
  j jsonb := to_jsonb(NEW);
  y int;
  m int;
BEGIN
  y := NULLIF(j ->> TG_ARGV[0], '')::int;
  m := NULLIF(j ->> TG_ARGV[1], '')::int;
  IF y IS NULL OR m IS NULL OR m < 1 OR m > 12 THEN
    NEW."competence" := NULL;
  ELSE
    NEW."competence" := lpad(y::text, 4, '0') || '-' || lpad(m::text, 2, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Billing e Income usam competenceYear/competenceMonth.
CREATE TRIGGER "Billing_competence_sync"
  BEFORE INSERT OR UPDATE ON "Billing"
  FOR EACH ROW EXECUTE FUNCTION b2c_set_competence('competenceYear', 'competenceMonth');

CREATE TRIGGER "Income_competence_sync"
  BEFORE INSERT OR UPDATE ON "Income"
  FOR EACH ROW EXECUTE FUNCTION b2c_set_competence('competenceYear', 'competenceMonth');

-- ClientMonthDelinquency, Payroll e Commission usam year/month.
CREATE TRIGGER "ClientMonthDelinquency_competence_sync"
  BEFORE INSERT OR UPDATE ON "ClientMonthDelinquency"
  FOR EACH ROW EXECUTE FUNCTION b2c_set_competence('year', 'month');

CREATE TRIGGER "Payroll_competence_sync"
  BEFORE INSERT OR UPDATE ON "Payroll"
  FOR EACH ROW EXECUTE FUNCTION b2c_set_competence('year', 'month');

CREATE TRIGGER "Commission_competence_sync"
  BEFORE INSERT OR UPDATE ON "Commission"
  FOR EACH ROW EXECUTE FUNCTION b2c_set_competence('year', 'month');

-- Backfill das linhas existentes (o UPDATE dispara o gatilho, que preenche).
UPDATE "Billing"                SET "competence" = NULL WHERE TRUE;
UPDATE "Income"                 SET "competence" = NULL WHERE TRUE;
UPDATE "ClientMonthDelinquency" SET "competence" = NULL WHERE TRUE;
UPDATE "Payroll"                SET "competence" = NULL WHERE TRUE;
UPDATE "Commission"             SET "competence" = NULL WHERE TRUE;

-- =====================================================================
-- WORKSPACE: uma linha para o dono atual (01 §4.2)
-- =====================================================================
INSERT INTO "Workspace" ("id", "name", "timezone", "locale", "currency", "ownerId", "createdAt", "updatedAt")
SELECT
  'ws_' || substr(md5(u."id"), 1, 21),
  'B2C Gestão',
  'America/Bahia',
  'pt-BR',
  'BRL',
  u."id",
  NOW(),
  NOW()
FROM "User" u
WHERE u."role" = 'ADMIN' AND u."workspaceOwnerId" IS NULL
ORDER BY u."createdAt"
LIMIT 1
ON CONFLICT DO NOTHING;
