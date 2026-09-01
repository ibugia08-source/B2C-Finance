-- F3.5 — CONCILIAÇÃO BANCÁRIA (ref. 01 §4.7; 02 §4.4)
--
-- Escrita à mão a partir de `prisma migrate diff`, com as duas linhas de
-- DROP INDEX removidas (User_workspaceOwnerId_idx e User_scopeAgencyId_idx são
-- índices criados à mão que o datamodel não declara; o diff propõe derrubá-los
-- a cada migration).

-- CreateEnum
CREATE TYPE "ReconciliationState" AS ENUM ('UNMATCHED', 'MATCHED', 'PARTIAL', 'IGNORED', 'REVIEW');



-- CreateTable
CREATE TABLE "BankStatement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "openingBalance" DECIMAL(14,2),
    "closingBalance" DECIMAL(14,2),
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankStatementEntry" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT,
    "hash" TEXT NOT NULL,
    "postedAt" TIMESTAMPTZ(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT NOT NULL,
    "balanceAfter" DECIMAL(14,2),
    "state" "ReconciliationState" NOT NULL DEFAULT 'UNMATCHED',
    "note" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BankStatementEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationMatch" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMPTZ(3),
    "confirmedBy" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankStatement_accountId_idx" ON "BankStatement"("accountId");

-- CreateIndex
CREATE INDEX "BankStatement_periodStart_idx" ON "BankStatement"("periodStart");

-- CreateIndex
CREATE INDEX "BankStatement_ownerId_idx" ON "BankStatement"("ownerId");

-- CreateIndex
CREATE INDEX "BankStatementEntry_statementId_idx" ON "BankStatementEntry"("statementId");

-- CreateIndex
CREATE INDEX "BankStatementEntry_state_idx" ON "BankStatementEntry"("state");

-- CreateIndex
CREATE INDEX "BankStatementEntry_postedAt_idx" ON "BankStatementEntry"("postedAt");

-- CreateIndex
CREATE INDEX "BankStatementEntry_ownerId_idx" ON "BankStatementEntry"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementEntry_accountId_hash_key" ON "BankStatementEntry"("accountId", "hash");

-- CreateIndex
CREATE INDEX "ReconciliationMatch_targetType_targetId_idx" ON "ReconciliationMatch"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "ReconciliationMatch_ownerId_idx" ON "ReconciliationMatch"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationMatch_entryId_targetType_targetId_key" ON "ReconciliationMatch"("entryId", "targetType", "targetId");

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementEntry" ADD CONSTRAINT "BankStatementEntry_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementEntry" ADD CONSTRAINT "BankStatementEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementEntry" ADD CONSTRAINT "BankStatementEntry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "BankStatementEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Só os cinco estados de 01 §4.7 — e o estado é SEMPRE derivado dos matches
-- pelo serviço, nunca digitado pela tela.
ALTER TABLE "BankStatementEntry" ADD CONSTRAINT "BankStatementEntry_amount_nao_zero"
  CHECK ("amount" <> 0);

-- Match de valor zero não liga nada a nada: é linha de ruído que faz a soma
-- parecer conferida.
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_amount_nao_zero"
  CHECK ("amount" <> 0);
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_confidence_faixa"
  CHECK ("confidence" BETWEEN 0 AND 100);
ALTER TABLE "ReconciliationMatch" ADD CONSTRAINT "ReconciliationMatch_target_conhecido"
  CHECK ("targetType" IN ('PAYMENT', 'TRANSACTION', 'INCOME', 'CASHBOX_MOVEMENT'));
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_formato_conhecido"
  CHECK ("format" IN ('OFX', 'CSV'));
ALTER TABLE "BankStatement" ADD CONSTRAINT "BankStatement_periodo_coerente"
  CHECK ("periodEnd" >= "periodStart");

-- F1.12: RLS em toda tabela privada. SEM FORCE (o Prisma conecta como dona da
-- tabela); o alvo é a API pública do Supabase.
ALTER TABLE "BankStatement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankStatementEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReconciliationMatch" ENABLE ROW LEVEL SECURITY;
