-- F3.3 · Provisão tributária + reserva restrita (01 §3.8; decisão 19.34).
--
-- Provisão e reserva são EVENTOS INDEPENDENTES, e confundi-los é o erro que
-- esta tabela existe para impedir: a provisão RECONHECE a obrigação (vira
-- despesa e passivo); a reserva SEGREGA caixa e não é despesa nenhuma. Quem
-- trata as duas como uma só conta o imposto duas vezes no resultado.
--
-- DECIDIDO 19.34: a restrição é POR RESERVA. Reserva restrita não conta na
-- liquidez disponível — aquele dinheiro tem dono e data, e mostrá-lo como
-- disponível é o que faz alguém aprovar uma despesa contra o imposto do mês
-- seguinte.
--
-- DROP INDEX de drift removido (ver 20260723210000).

ALTER TABLE "CashBox" ADD COLUMN "restricted" BOOLEAN NOT NULL DEFAULT false;

-- Impostos e 13º nascem restritos (19.34). Reconhecidos pelo nome, que é o
-- que existe hoje — quando houver um tipo próprio, ele manda.
UPDATE "CashBox"
   SET "restricted" = TRUE
 WHERE lower("name") ~ '(imposto|tribut|13|d[eé]cimo)';

CREATE TABLE "TaxProvision" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "baseAmount" DECIMAL(14,2) NOT NULL,
    "rate" DECIMAL(6,4) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "basis" TEXT NOT NULL DEFAULT 'FATURAMENTO',
    "postedAt" TIMESTAMPTZ(3),
    "reserveSuggested" DECIMAL(14,2),
    "reserveDoneAt" TIMESTAMPTZ(3),
    "reserveDoneBy" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TaxProvision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaxProvision_competence_idx" ON "TaxProvision"("competence");
CREATE INDEX "TaxProvision_ownerId_idx" ON "TaxProvision"("ownerId");
CREATE UNIQUE INDEX "TaxProvision_legalEntityId_competence_key"
  ON "TaxProvision"("legalEntityId", "competence");

ALTER TABLE "TaxProvision" ADD CONSTRAINT "TaxProvision_legalEntityId_fkey"
  FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaxProvision" ADD CONSTRAINT "TaxProvision_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TaxProvision" ADD CONSTRAINT "TaxProvision_competence_formato"
  CHECK ("competence" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
-- Alíquota fora de 0-100 é erro de digitação virando obrigação fiscal.
ALTER TABLE "TaxProvision" ADD CONSTRAINT "TaxProvision_aliquota_valida"
  CHECK ("rate" >= 0 AND "rate" <= 100);
ALTER TABLE "TaxProvision" ADD CONSTRAINT "TaxProvision_valores_positivos"
  CHECK ("baseAmount" >= 0 AND "amount" >= 0);

ALTER TABLE "TaxProvision" ENABLE ROW LEVEL SECURITY;
