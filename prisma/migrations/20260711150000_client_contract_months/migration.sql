-- Prazo do contrato do cliente (em meses) — editável inline em Recebimentos
-- e refletido no cadastro (Gestão de Carteira). Aditiva.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "contractMonths" INTEGER;
