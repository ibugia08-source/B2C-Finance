-- Parâmetros financeiros do workspace.
--
-- Nasce para a LIQUIDEZ DISPONÍVEL v2 (01 §7.2): com as reservas (CashBox)
-- removidas em 10/09/2026, o desconto do disponível deixou de ser "reserva
-- restrita" e passou a ser COMPROMISSO IMEDIATO — conta a pagar vencida ou
-- vencendo dentro de uma janela de dias. A janela é configurável porque
-- "imediato" muda com o ciclo de pagamento de cada operação; o padrão (7)
-- mora no código, não aqui, para que a coluna nova não precise de backfill.
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "financeSettings" JSONB NOT NULL DEFAULT '{}';
