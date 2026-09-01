-- F4.6 — parâmetros comerciais no workspace (ref. 01 §7.5).
--
-- Guarda a BASE DE VALORAÇÃO do MRR usada no ROAS, que a spec chama de
-- "parâmetro obrigatório". Sem ela o ROAS NÃO é calculado: valorizar uma
-- mensalidade de R$ 2.000 pelo primeiro mês ou pelo contrato de doze meses dá
-- dois números que diferem por doze vezes — e os dois se chamariam "ROAS".

ALTER TABLE "Workspace" ADD COLUMN "commercialSettings" JSONB NOT NULL DEFAULT '{}';
