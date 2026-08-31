-- =====================================================================
-- F1.4 (complemento) — relationshipId da cobrança por GATILHO
--
-- A coluna nasceu no backfill da migration anterior, mas cobrança NOVA
-- continuaria nascendo sem ela: são DEZ pontos de criação no código, mais
-- os imports e o SQL cru. Preencher em dez lugares é garantia de esquecer
-- no décimo primeiro.
--
-- Mesmo padrão que a F0.4 usou para a competência: o banco preenche. Se
-- alguém informar a relação explicitamente, ela é respeitada; se não, sai
-- da relação do cliente (a mais antiga, quando houver mais de uma agência).
-- Cliente sem relação nenhuma deixa a coluna nula em vez de falhar — a
-- cobrança é fato financeiro e não pode ser bloqueada por cadastro.
-- =====================================================================

CREATE OR REPLACE FUNCTION b2c_set_billing_relationship()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."relationshipId" IS NULL THEN
    SELECT r."id" INTO NEW."relationshipId"
      FROM "ClientAgencyRelationship" r
     WHERE r."clientId" = NEW."clientId"
     ORDER BY r."createdAt" ASC, r."id" ASC
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_billing_relationship ON "Billing";
CREATE TRIGGER trg_billing_relationship
  BEFORE INSERT ON "Billing"
  FOR EACH ROW EXECUTE FUNCTION b2c_set_billing_relationship();
