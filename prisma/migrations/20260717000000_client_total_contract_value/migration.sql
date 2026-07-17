-- Valor TOTAL do contrato TCV no cadastro do cliente (referência editável no
-- nível do cliente; espelha Contract.totalValue da venda/renovação). Usado
-- somente em TCV; MRR continua usando monthlyValue. Aditiva e segura.
ALTER TABLE "Client" ADD COLUMN IF NOT EXISTS "totalContractValue" DECIMAL(14,2);
