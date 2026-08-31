-- F3.7 · Reparcelamento (01 §3.13).
--
-- "NÃO cria nova receita." A frase é a regra inteira e a mais fácil de
-- violar: as parcelas novas parecem cobranças normais e, se entrarem como
-- receita, o faturamento do mês salta com dinheiro que já foi faturado meses
-- atrás. Por isso elas nascem SETTLEMENT_ONLY.
--
-- RENEGOTIATED é um status novo, e não "paga" nem "cancelada": a dívida
-- existe, mudou de lugar. Marcá-la como paga faria o recebido do mês subir
-- sem ninguém ter pago nada; como cancelada, sumiria da história do cliente.
--
-- ALTER TYPE ... ADD VALUE não roda dentro de transação no Postgres; por isso
-- ele vem primeiro e sozinho, antes de qualquer DDL que dependa dele.
--
-- DROP INDEX de drift removido (ver 20260723210000).

ALTER TYPE "BillingStatus" ADD VALUE IF NOT EXISTS 'RENEGOTIATED';



-- AlterTable
ALTER TABLE "Billing" ADD COLUMN     "renegotiatedInId" TEXT,
ADD COLUMN     "settlementOfId" TEXT;

-- CreateTable
CREATE TABLE "RenegotiationAgreement" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT,
    "clientId" TEXT NOT NULL,
    "originalBalance" DECIMAL(14,2) NOT NULL,
    "negotiatedBalance" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "interestAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "installments" INTEGER NOT NULL,
    "signedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdBy" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RenegotiationAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RenegotiationAgreement_clientId_idx" ON "RenegotiationAgreement"("clientId");

-- CreateIndex
CREATE INDEX "RenegotiationAgreement_status_idx" ON "RenegotiationAgreement"("status");

-- CreateIndex
CREATE INDEX "RenegotiationAgreement_ownerId_idx" ON "RenegotiationAgreement"("ownerId");

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_renegotiatedInId_fkey" FOREIGN KEY ("renegotiatedInId") REFERENCES "RenegotiationAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Billing" ADD CONSTRAINT "Billing_settlementOfId_fkey" FOREIGN KEY ("settlementOfId") REFERENCES "RenegotiationAgreement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenegotiationAgreement" ADD CONSTRAINT "RenegotiationAgreement_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ClientAgencyRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenegotiationAgreement" ADD CONSTRAINT "RenegotiationAgreement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenegotiationAgreement" ADD CONSTRAINT "RenegotiationAgreement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Um acordo com zero parcelas não é acordo.
ALTER TABLE "RenegotiationAgreement" ADD CONSTRAINT "Renegotiation_parcelas_minimas"
  CHECK ("installments" >= 1);
-- Desconto e juros não podem ser negativos: o sinal é dado pelo campo, não
-- pelo valor, senão "desconto de -500" viraria juros escondido.
ALTER TABLE "RenegotiationAgreement" ADD CONSTRAINT "Renegotiation_valores_positivos"
  CHECK ("originalBalance" >= 0 AND "negotiatedBalance" >= 0
         AND "discountAmount" >= 0 AND "interestAmount" >= 0);
-- A conta do acordo tem de fechar: original - desconto + juros = negociado.
-- Sem isto, um acordo pode existir dizendo qualquer coisa, e a diferença só
-- aparece quando o cliente termina de pagar e o saldo não zera.
ALTER TABLE "RenegotiationAgreement" ADD CONSTRAINT "Renegotiation_conta_fecha"
  CHECK (abs(("originalBalance" - "discountAmount" + "interestAmount") - "negotiatedBalance") < 0.01);

ALTER TABLE "RenegotiationAgreement" ENABLE ROW LEVEL SECURITY;
