-- Auditoria da remoção de cobrança do ciclo mensal (Recebimentos):
-- quem removeu e por quê. Aditiva — não altera dados existentes.
ALTER TABLE "Billing" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "Billing" ADD COLUMN IF NOT EXISTS "canceledBy" TEXT;
