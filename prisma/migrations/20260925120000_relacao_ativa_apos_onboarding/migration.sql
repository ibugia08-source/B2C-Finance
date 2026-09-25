-- RELAÇÃO ATIVA DEPOIS DA IMPLANTAÇÃO (auditoria 25/09/2026).
--
-- Concluir o onboarding gravava só onboardingStatus; a relação cliente ↔
-- agência seguia em lifecycleStatus = ONBOARDING para sempre. O checklist de
-- fechamento conta a carteira por lifecycleStatus = ACTIVE, então esses
-- clientes sumiam de "carteira ativa", "MRR sem cobrança" e "sem gestor".
-- O código agora promove na conclusão; aqui, o backfill de quem já concluiu.
UPDATE "ClientAgencyRelationship"
SET "lifecycleStatus" = 'ACTIVE'
WHERE "lifecycleStatus" = 'ONBOARDING'
  AND "onboardingStatus" IN ('COMPLETE', 'EXCEPTION');

-- CLIENTE PERDIDO COM RELAÇÃO AINDA ATIVA (mesma auditoria).
-- "Perdido" pela carteira mudava só Client.status; a relação e o termo
-- seguiam vigentes e o NRR, as avaliações e o painel do gestor continuavam
-- contando o cliente. O código agora encerra relação e termo na saída; aqui,
-- os que já estão assim: termo vigente fecha na data de saída do cliente e a
-- relação vira CHURNED na mesma data.
UPDATE "CommercialTerm" t
SET "validTo" = GREATEST(COALESCE(c."churnedAt", now()), t."validFrom")
FROM "ClientAgencyRelationship" r
JOIN "Client" c ON c."id" = r."clientId"
WHERE t."id" = r."currentCommercialTermId"
  AND c."status" = 'CHURNED'
  AND r."lifecycleStatus" <> 'CHURNED'
  AND t."validTo" IS NULL;

UPDATE "ClientAgencyRelationship" r
SET "lifecycleStatus" = 'CHURNED',
    "churnedAt" = COALESCE(c."churnedAt", now()),
    "currentCommercialTermId" = NULL
FROM "Client" c
WHERE c."id" = r."clientId"
  AND c."status" = 'CHURNED'
  AND r."lifecycleStatus" <> 'CHURNED';
