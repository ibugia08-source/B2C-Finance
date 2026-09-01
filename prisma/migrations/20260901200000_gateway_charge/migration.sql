-- F5.2 — cobrança emitida no provedor de pagamento (Pix/boleto).
CREATE TABLE "GatewayCharge" (
    "id" TEXT NOT NULL,
    "billingId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "chargeId" TEXT,
    "link" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GatewayCharge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GatewayCharge_billingId_idx" ON "GatewayCharge"("billingId");
CREATE INDEX "GatewayCharge_status_idx" ON "GatewayCharge"("status");

-- Idempotência NO BANCO (03 §4.3), como unique PARCIAL: o chargeId só chega
-- pelo webhook, então antes dele a coluna é nula — e NULL nunca é igual a
-- NULL num índice único comum, o que deixaria duplicatas conviverem caladas.
CREATE UNIQUE INDEX "GatewayCharge_provider_chargeId_key"
    ON "GatewayCharge"("provider", "chargeId")
    WHERE "chargeId" IS NOT NULL;

-- UMA cobrança viva por billing: emitir dois links para a mesma fatura é o
-- caminho mais curto para o cliente pagar duas vezes.
CREATE UNIQUE INDEX "GatewayCharge_billing_viva_key"
    ON "GatewayCharge"("billingId")
    WHERE "status" IN ('PENDING', 'ACTIVE');

ALTER TABLE "GatewayCharge" ADD CONSTRAINT "GatewayCharge_billingId_fkey"
    FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatewayCharge" ADD CONSTRAINT "GatewayCharge_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
