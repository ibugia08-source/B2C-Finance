-- F3.8 · Ajuste de cobrança (01 §4.7).
--
-- DECIDIDO 19.35/19.36 (31/08): NÃO existem tetos nem fila de aprovação.
-- Quem tem a permissão faz, e fica registrado. Por isso não há coluna de
-- aprovador nem de estado de aprovação — campo que nunca é preenchido é pior
-- que campo nenhum: dá a impressão de um controle que não existe.
--
-- O que fica é o essencial: valor ORIGINAL preservado, motivo obrigatório e
-- quem fez. Ajuste sem valor original é uma cobrança que mudou de preço sem
-- ninguém conseguir dizer de quanto para quanto.
--
-- DROP INDEX de drift removido (ver 20260723210000).

CREATE TYPE "BillingAdjustmentType" AS ENUM ('DISCOUNT', 'FEE', 'INTEREST', 'WRITE_OFF', 'CORRECTION');

CREATE TABLE "BillingAdjustment" (
    "id" TEXT NOT NULL,
    "billingId" TEXT NOT NULL,
    "type" "BillingAdjustmentType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "originalAmount" DECIMAL(14,2) NOT NULL,
    "resultingAmount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedBy" TEXT,
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BillingAdjustment_billingId_idx" ON "BillingAdjustment"("billingId");
CREATE INDEX "BillingAdjustment_type_idx" ON "BillingAdjustment"("type");
CREATE INDEX "BillingAdjustment_ownerId_idx" ON "BillingAdjustment"("ownerId");

ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_billingId_fkey"
  FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Motivo obrigatório de verdade: a regra é do banco, não só da tela.
-- "write-off sempre com motivo" (§4.7) — e desconto sem motivo é a mesma
-- história com outro nome.
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_motivo_obrigatorio"
  CHECK (length(btrim("reason")) >= 5);
ALTER TABLE "BillingAdjustment" ADD CONSTRAINT "BillingAdjustment_valor_positivo"
  CHECK ("amount" > 0);

ALTER TABLE "BillingAdjustment" ENABLE ROW LEVEL SECURITY;
