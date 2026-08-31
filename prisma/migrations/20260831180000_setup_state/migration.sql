-- F1.20 · Estado do setup guiado (02 §3).
--
-- Guarda SÓ o que não dá para deduzir do dado: quais passos o dono adiou e
-- quando encerrou a lista. "Passo concluído" nunca entra aqui — isso se
-- pergunta ao banco (existe agência? existe cliente? existe conta?), porque
-- uma lista que se diz pronta por causa de um clique mente sobre o sistema.
--
-- DROP INDEX de drift do prisma migrate diff removido de propósito (ver
-- 20260723210000).

ALTER TABLE "Workspace" ADD COLUMN "setupState" JSONB NOT NULL DEFAULT '{}';
