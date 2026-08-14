-- Conciliação ligada ao pagamento: a reversão apaga por paymentId,
-- nunca por coincidência de valor/data (auditoria 2026-08-13).
ALTER TABLE "Income" ADD COLUMN "paymentId" TEXT;

CREATE INDEX "Income_paymentId_idx" ON "Income"("paymentId");

-- Invariante do sistema: UMA cobrança MRR viva por (cliente, competência).
-- Blindagem no banco contra qualquer porta de criação duplicar mensalidade
-- (ciclo, inclusão manual, renovação, geração por contrato). Parcial de
-- propósito: CANCELED fica de fora (removidos do mês) e TCV/ONE_TIME/SETUP
-- podem legitimamente repetir na mesma competência.
CREATE UNIQUE INDEX "Billing_client_competence_mrr_key"
ON "Billing"("clientId", "competenceYear", "competenceMonth")
WHERE "revenueType" = 'MRR' AND "status" <> 'CANCELED';
