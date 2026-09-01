-- F4.3 — a agência da atividade diária deixa de ter chave estrangeira.
--
-- ACHADO PELO TESTE, e é uma colisão de duas regras boas:
--
--  · o índice único de (data, SDR, agência) precisa de um valor NÃO NULO,
--    porque NULL não colide com NULL no Postgres — com NULL, o mesmo dia do
--    mesmo SDR entraria duas vezes e a contagem do mês dobraria em silêncio;
--  · nenhuma chave estrangeira aceita a string vazia como sentinela de "sem
--    agência".
--
-- Entre perder a trava do dia duplicado e perder a checagem de existência da
-- agência, a trava vale mais: o duplicado é invisível e estraga a métrica; a
-- agência inexistente aparece na tela como um nome que não resolve.

ALTER TABLE "AtividadeDiaria" DROP CONSTRAINT "AtividadeDiaria_agencyId_fkey";
ALTER TABLE "GastoAdsDiario" DROP CONSTRAINT "GastoAdsDiario_agencyId_fkey";
