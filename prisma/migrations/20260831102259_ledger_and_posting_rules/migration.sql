-- =====================================================================
-- F0.8 — RAZÃO, REGRAS DE LANÇAMENTO E BANDEIRAS (ref. 01 §3.10-3.11, §4.9)
--
-- Nenhuma tela escreve no razão: o domínio publica um fato e o
-- AccountingEngine aplica a PostingRule ativa e versionada.
--
-- As travas de integridade (débito e crédito não negativos, um lado por
-- lançamento) são acrescentadas ao fim deste arquivo como CHECK constraints —
-- o Prisma não as declara, mas elas precisam existir no banco: é o que impede
-- um lançamento inválido mesmo por SQL cru.
--
-- A bandeira ledger_enabled nasce DESLIGADA, como manda a tarefa.
--
-- DROP INDEX de drift removido de novo.
-- =====================================================================

-- CreateTable
CREATE TABLE "PostingRule" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "debitAccountCode" TEXT NOT NULL,
    "creditAccountCode" TEXT NOT NULL,
    "affectsPnl" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PostingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "postedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversalOfId" TEXT,
    "postingRuleVersion" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "ledgerTransactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "agencyId" TEXT,
    "clientId" TEXT,
    "serviceId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostingRule_workspaceId_eventType_active_idx" ON "PostingRule"("workspaceId", "eventType", "active");

-- CreateIndex
CREATE UNIQUE INDEX "PostingRule_workspaceId_eventType_version_key" ON "PostingRule"("workspaceId", "eventType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_reversalOfId_key" ON "LedgerTransaction"("reversalOfId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_workspaceId_competence_idx" ON "LedgerTransaction"("workspaceId", "competence");

-- CreateIndex
CREATE INDEX "LedgerTransaction_workspaceId_eventType_idx" ON "LedgerTransaction"("workspaceId", "eventType");

-- CreateIndex
CREATE INDEX "LedgerTransaction_sourceType_sourceId_idx" ON "LedgerTransaction"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_ownerId_idx" ON "LedgerTransaction"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_workspaceId_idempotencyKey_key" ON "LedgerTransaction"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_ledgerTransactionId_idx" ON "LedgerEntry"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_idx" ON "LedgerEntry"("accountId");

-- CreateIndex
CREATE INDEX "LedgerEntry_clientId_idx" ON "LedgerEntry"("clientId");

-- CreateIndex
CREATE INDEX "LedgerEntry_agencyId_idx" ON "LedgerEntry"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_workspaceId_key_key" ON "FeatureFlag"("workspaceId", "key");

-- AddForeignKey
ALTER TABLE "PostingRule" ADD CONSTRAINT "PostingRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "LedgerTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AccountingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeatureFlag" ADD CONSTRAINT "FeatureFlag_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- TRAVAS DE INTEGRIDADE DO RAZÃO (03 §4.3)
-- =====================================================================
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_valores_nao_negativos"
  CHECK ("debit" >= 0 AND "credit" >= 0);

-- Um lançamento tem UM lado: ou débito, ou crédito — nunca os dois, nunca nenhum.
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_um_lado_apenas"
  CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0));

-- =====================================================================
-- BANDEIRA: postagem no razão nasce DESLIGADA (F0.8)
-- =====================================================================
INSERT INTO "FeatureFlag" ("id", "workspaceId", "key", "enabled", "description", "updatedAt")
SELECT 'ff_' || substr(md5(w."id" || 'ledger'), 1, 21), w."id", 'ledger_enabled', FALSE,
       'Libera a gravação de lançamentos no razão pelo AccountingEngine (01 §3.10).', NOW()
FROM "Workspace" w
WHERE NOT EXISTS (
  SELECT 1 FROM "FeatureFlag" f WHERE f."workspaceId" = w."id" AND f."key" = 'ledger_enabled'
);
