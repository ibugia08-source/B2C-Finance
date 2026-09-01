-- F3.4 — MOTOR GENÉRICO DE RATEIO (ref. 01 §4.7, §3.14; 02 §4.4)
--
-- Escrita à mão a partir de `prisma migrate diff`, com DUAS linhas removidas:
-- o diff insiste em propor `DROP INDEX "User_workspaceOwnerId_idx"` e
-- `DROP INDEX "User_scopeAgencyId_idx"` — índices criados à mão em migrations
-- anteriores, que o datamodel não declara. Deixá-los cair aqui derrubaria a
-- consulta de escopo de dados a cada deploy.

CREATE TYPE "AllocationDimension" AS ENUM ('AGENCY', 'CLIENT', 'SERVICE');
CREATE TYPE "AllocationMethod" AS ENUM ('MANUAL', 'FIXED_PERCENT', 'PROPORTIONAL', 'RULE');

CREATE TABLE "Allocation" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'TRANSACTION',
    "sourceId" TEXT NOT NULL,
    "dimensionType" "AllocationDimension" NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "percentage" DECIMAL(9,6),
    "method" "AllocationMethod" NOT NULL DEFAULT 'MANUAL',
    "ruleId" TEXT,
    "competence" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Allocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AllocationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "descriptionContains" TEXT,
    "categoryId" TEXT,
    "expenseType" "ExpenseType",
    "dimensionType" "AllocationDimension" NOT NULL,
    "dimensionId" TEXT NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AllocationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Allocation_sourceType_sourceId_idx" ON "Allocation"("sourceType", "sourceId");
CREATE INDEX "Allocation_competence_idx" ON "Allocation"("competence");
CREATE INDEX "Allocation_dimensionType_dimensionId_idx" ON "Allocation"("dimensionType", "dimensionId");
CREATE INDEX "Allocation_ownerId_idx" ON "Allocation"("ownerId");
CREATE INDEX "Allocation_ownerId_competence_idx" ON "Allocation"("ownerId", "competence");

-- Uma linha por dimensão em cada origem. Sem isto, "adicionar o cliente X"
-- duas vezes na mesma fatura é um clique — e o custo dele aparece dobrado na
-- margem sem nada na tela denunciando.
CREATE UNIQUE INDEX "Allocation_sourceType_sourceId_dimensionType_dimensionId_key"
  ON "Allocation"("sourceType", "sourceId", "dimensionType", "dimensionId");

CREATE INDEX "AllocationRule_active_priority_idx" ON "AllocationRule"("active", "priority");
CREATE INDEX "AllocationRule_ownerId_idx" ON "AllocationRule"("ownerId");

ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_ruleId_fkey"
  FOREIGN KEY ("ruleId") REFERENCES "AllocationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AllocationRule" ADD CONSTRAINT "AllocationRule_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AllocationRule" ADD CONSTRAINT "AllocationRule_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Competência é dimensão explícita YYYY-MM (01 §3.15).
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_competence_formato"
  CHECK ("competence" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Fatia de zero ou negativa não é rateio: é linha de ruído que aparece na
-- tela do gestor sem significar nada.
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_amount_positivo"
  CHECK ("amount" > 0);
ALTER TABLE "Allocation" ADD CONSTRAINT "Allocation_percentage_faixa"
  CHECK ("percentage" IS NULL OR "percentage" BETWEEN 0 AND 100);

-- ===========================================================================
-- A INVARIANTE DO RATEIO, NO BANCO (01 §4.7: "soma não ultrapassa a origem")
-- ===========================================================================
--
-- Está aqui, e não só no serviço, porque é a única regra do módulo cujo erro
-- é INVISÍVEL: ratear 120% de uma fatura de mídia não estoura tela nenhuma —
-- ele só faz a soma das margens de contribuição dos clientes ficar menor que
-- o resultado real, e ninguém procura a diferença no lugar certo.
--
-- Confere só o que consegue conferir sozinha: hoje a origem é sempre uma
-- transação. Outro `sourceType` passa direto, de propósito — melhor uma
-- guarda honesta e parcial que uma que finge cobrir o que não cobre.
CREATE OR REPLACE FUNCTION b2c_allocation_nao_ultrapassa() RETURNS trigger AS $$
DECLARE
  origem numeric(14,2);
  soma   numeric(14,2);
BEGIN
  IF NEW."sourceType" <> 'TRANSACTION' THEN
    RETURN NEW;
  END IF;

  SELECT "amount" INTO origem FROM "Transaction" WHERE "id" = NEW."sourceId";
  IF origem IS NULL THEN
    RAISE EXCEPTION 'Rateio sem origem: a despesa % não existe.', NEW."sourceId";
  END IF;

  SELECT COALESCE(SUM("amount"), 0) INTO soma
    FROM "Allocation"
   WHERE "sourceType" = NEW."sourceType"
     AND "sourceId" = NEW."sourceId"
     AND "id" <> NEW."id";

  -- Meio centavo de folga: o residual do rateio é determinístico, mas a
  -- comparação em numeric não precisa ser hostil a arredondamento.
  IF soma + NEW."amount" > origem + 0.005 THEN
    RAISE EXCEPTION 'O rateio (%) ultrapassa o valor da despesa (%).',
      soma + NEW."amount", origem;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "b2c_allocation_nao_ultrapassa"
  BEFORE INSERT OR UPDATE ON "Allocation"
  FOR EACH ROW EXECUTE FUNCTION b2c_allocation_nao_ultrapassa();

-- F1.12: RLS em toda tabela privada. SEM FORCE (o Prisma conecta como dona
-- da tabela); o alvo é a API pública do Supabase. Mesmo padrão da 20260831190000.
ALTER TABLE "Allocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AllocationRule" ENABLE ROW LEVEL SECURITY;
