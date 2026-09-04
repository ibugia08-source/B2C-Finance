-- RECEITA EXTRA ganha COMPETÊNCIA própria: o exercício em que o valor entra
-- é informado no ato do cadastro e pode diferir do mês do caixa.
ALTER TABLE "ExtraRevenue" ADD COLUMN "competenceMonth" INTEGER;
ALTER TABLE "ExtraRevenue" ADD COLUMN "competenceYear" INTEGER;

-- Legado: linha antiga entra no exercício do mês em que o caixa entrou —
-- é onde as telas sempre a mostraram.
UPDATE "ExtraRevenue"
SET "competenceMonth" = EXTRACT(MONTH FROM "receivedAt")::int,
    "competenceYear"  = EXTRACT(YEAR FROM "receivedAt")::int
WHERE "competenceMonth" IS NULL;

CREATE INDEX "ExtraRevenue_competenceYear_competenceMonth_idx"
  ON "ExtraRevenue"("competenceYear", "competenceMonth");

-- Faixa válida quando preenchida (mesma regra das demais competências).
ALTER TABLE "ExtraRevenue" ADD CONSTRAINT "ExtraRevenue_competence_range"
  CHECK (("competenceMonth" IS NULL OR ("competenceMonth" BETWEEN 1 AND 12))
     AND ("competenceYear" IS NULL OR ("competenceYear" BETWEEN 2000 AND 2100)));
