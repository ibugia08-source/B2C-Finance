-- =====================================================================
-- F1.10 (v2) — PROVENIÊNCIA PARA A IMPORTAÇÃO TOTAL
--
-- O modelo de 3 abas (CLIENTES/MENSAL/RENOVACOES) faz a MESMA planilha
-- alimentar entidades diferentes; sem a aba na proveniência, "linha 37"
-- não diz de onde a linha veio.
--
-- `operation` existe para a REVERSÃO do lote: o que o lote CRIOU pode ser
-- desfeito por inteiro; o que ele ATUALIZOU não tem imagem anterior — a
-- reversão precisa distinguir os dois para nunca prometer o que não faz.
-- =====================================================================

ALTER TABLE "ImportedRecord" ADD COLUMN "sourceSheet" TEXT;
ALTER TABLE "ImportedRecord" ADD COLUMN "operation" TEXT NOT NULL DEFAULT 'CRIOU';

ALTER TABLE "ImportedRecord" ADD CONSTRAINT "ImportedRecord_operation_conhecida"
  CHECK ("operation" IN ('CRIOU', 'ATUALIZOU'));
