-- =====================================================================
-- F1.4 — BILLING 2.0: aplicação de pagamento e crédito (01 §4.5, §3.12)
--
-- Três mudanças de fundo:
--
-- 1. A cobrança passa a pertencer à RELAÇÃO cliente↔agência, e ganha o
--    vocabulário da spec: billingKind (o QUE se cobra) e recognitionMode
--    (se aquilo RECONHECE receita ou só liquida dívida antiga). O segundo
--    existe para renegociação não dobrar o faturamento: a receita já foi
--    reconhecida quando a dívida nasceu (01 §3.13).
--
-- 2. PaymentApplication liga pagamento e cobrança COM VALOR. Sem ela, um
--    pagamento só podia quitar uma cobrança — e o caso real de "o cliente
--    mandou um Pix cobrindo três meses" não tinha representação.
--
-- 3. paidTotal deixa de ser somado na mão e passa a ser DERIVADO das
--    aplicações. Continua materializado na coluna (01 §4.5 autoriza) porque
--    a listagem do mês precisa dele sem juntar tabela, mas a fonte é a soma
--    das aplicações — e o backfill abaixo prova que as duas batem.
--
-- CONFERÊNCIA DO BACKFILL: ao final, toda cobrança tem
--     paidTotal == Σ aplicações
-- ou a migration aborta. Dinheiro não migra no escuro.
--
-- DROP INDEX de drift removido do diff, como em toda migration desde a F0.3.
-- =====================================================================

-- CreateEnum
CREATE TYPE "BillingKind" AS ENUM ('MRR', 'TCV', 'SETUP', 'ONE_TIME', 'UPSELL', 'RENEGOTIATION');

-- CreateEnum
CREATE TYPE "RecognitionMode" AS ENUM ('REVENUE', 'SETTLEMENT_ONLY');

-- CreateEnum
CREATE TYPE "CreditMovementKind" AS ENUM ('IN', 'OUT');


-- AlterTable
ALTER TABLE "Billing" ADD COLUMN     "billingKind" "BillingKind" NOT NULL DEFAULT 'MRR',
ADD COLUMN     "installmentGroupId" TEXT,
ADD COLUMN     "installmentNumber" INTEGER,
ADD COLUMN     "recognitionMode" "RecognitionMode" NOT NULL DEFAULT 'REVENUE',
ADD COLUMN     "relationshipId" TEXT;

-- CreateTable
CREATE TABLE "PaymentApplication" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "billingId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "appliedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCredit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "relationshipId" TEXT,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomerCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCreditMovement" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "kind" "CreditMovementKind" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "sourcePaymentId" TEXT,
    "targetBillingId" TEXT,
    "reason" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerCreditMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentApplication_billingId_idx" ON "PaymentApplication"("billingId");

-- CreateIndex
CREATE INDEX "PaymentApplication_ownerId_idx" ON "PaymentApplication"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentApplication_paymentId_billingId_key" ON "PaymentApplication"("paymentId", "billingId");

-- CreateIndex
CREATE INDEX "CustomerCredit_ownerId_idx" ON "CustomerCredit"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerCredit_clientId_relationshipId_key" ON "CustomerCredit"("clientId", "relationshipId");

-- CreateIndex
CREATE INDEX "CustomerCreditMovement_creditId_idx" ON "CustomerCreditMovement"("creditId");

-- CreateIndex
CREATE INDEX "CustomerCreditMovement_ownerId_idx" ON "CustomerCreditMovement"("ownerId");

-- CreateIndex
CREATE INDEX "Billing_relationshipId_idx" ON "Billing"("relationshipId");

-- CreateIndex
CREATE INDEX "Billing_installmentGroupId_idx" ON "Billing"("installmentGroupId");

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ClientAgencyRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentApplication" ADD CONSTRAINT "PaymentApplication_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentApplication" ADD CONSTRAINT "PaymentApplication_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentApplication" ADD CONSTRAINT "PaymentApplication_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCredit" ADD CONSTRAINT "CustomerCredit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCredit" ADD CONSTRAINT "CustomerCredit_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ClientAgencyRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCredit" ADD CONSTRAINT "CustomerCredit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditMovement" ADD CONSTRAINT "CustomerCreditMovement_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "CustomerCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditMovement" ADD CONSTRAINT "CustomerCreditMovement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- BACKFILL
-- =====================================================================

-- 1) Vocabulário novo a partir do que o v1 já sabia.
UPDATE "Billing"
   SET "billingKind" = CASE "revenueType"
         WHEN 'MRR'      THEN 'MRR'::"BillingKind"
         WHEN 'TCV'      THEN 'TCV'::"BillingKind"
         WHEN 'SETUP'    THEN 'SETUP'::"BillingKind"
         WHEN 'ONE_TIME' THEN 'ONE_TIME'::"BillingKind"
         ELSE 'ONE_TIME'::"BillingKind"
       END,
       -- RECOVERY é liquidação de dívida antiga, não faturamento novo.
       "recognitionMode" = CASE WHEN "revenueType" = 'RECOVERY'
                                THEN 'SETTLEMENT_ONLY'::"RecognitionMode"
                                ELSE 'REVENUE'::"RecognitionMode" END;

-- 2) A cobrança passa a apontar para a relação do seu cliente.
UPDATE "Billing" b
   SET "relationshipId" = r."id"
  FROM "ClientAgencyRelationship" r
 WHERE r."clientId" = b."clientId"
   AND b."relationshipId" IS NULL;

-- 3) Uma aplicação por pagamento existente (o v1 era 1:1).
INSERT INTO "PaymentApplication" ("id", "paymentId", "billingId", "amount", "appliedAt", "ownerId", "createdAt")
SELECT 'app_' || p."id", p."id", p."billingId", p."amount", p."paidAt", p."ownerId", NOW()
FROM "Payment" p
WHERE p."status" NOT IN ('FAILED', 'REFUNDED')
ON CONFLICT ("paymentId", "billingId") DO NOTHING;

-- 4) CONFERÊNCIA: paidTotal tem de bater com a soma das aplicações.
--    Tolerância de 1 centavo para o arredondamento de Decimal(14,2).
DO $$
DECLARE divergentes INT;
BEGIN
  SELECT COUNT(*) INTO divergentes
    FROM "Billing" b
    LEFT JOIN (
      SELECT "billingId", SUM("amount") AS aplicado
        FROM "PaymentApplication" GROUP BY "billingId"
    ) a ON a."billingId" = b."id"
   WHERE ABS(b."paidTotal" - COALESCE(a.aplicado, 0)) > 0.01;

  IF divergentes > 0 THEN
    RAISE EXCEPTION 'F1.4: % cobranca(s) com paidTotal diferente da soma das aplicacoes. Backfill abortado.', divergentes;
  END IF;
END $$;

