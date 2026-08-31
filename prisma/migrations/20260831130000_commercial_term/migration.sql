-- =====================================================================
-- F1.2 — CommercialTerm: a FONTE TEMPORAL do que foi combinado (01 §4.4)
--
-- No v1 o valor morava em Client.monthlyValue, um campo só. Reajustar o
-- cliente SOBRESCREVIA o passado — e a partir daí nenhuma métrica
-- histórica sabia quanto ele valia em março. 01 §4.4 é categórico:
-- "Client.monthlyValue existe só como cache do valor atual; métrica
-- histórica NUNCA o usa".
--
-- Escrita à mão: o `prisma migrate dev` recusa rodar sem terminal
-- interativo quando a mudança inclui UNIQUE nova (aqui, o cache de termo
-- vigente na relação) — mesma situação da F0.9.
--
-- O DROP INDEX "User_workspaceOwnerId_idx" que o diff propôs foi
-- REMOVIDO: é drift de um índice criado por SQL cru em 20260723210000,
-- invisível ao schema.prisma.
-- =====================================================================

-- CreateTable
CREATE TABLE "CommercialTerm" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "modality" "ClientModality" NOT NULL,
    "monthlyValue" DECIMAL(14,2),
    "totalContractValue" DECIMAL(14,2),
    "contractMonths" INTEGER,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "contractId" TEXT,
    "reason" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CommercialTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommercialTerm_relationshipId_validFrom_idx" ON "CommercialTerm"("relationshipId", "validFrom");

-- CreateIndex
CREATE INDEX "CommercialTerm_validFrom_idx" ON "CommercialTerm"("validFrom");

-- CreateIndex
CREATE INDEX "CommercialTerm_ownerId_idx" ON "CommercialTerm"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAgencyRelationship_currentCommercialTermId_key" ON "ClientAgencyRelationship"("currentCommercialTermId");

-- AddForeignKey
ALTER TABLE "ClientAgencyRelationship" ADD CONSTRAINT "ClientAgencyRelationship_currentCommercialTermId_fkey" FOREIGN KEY ("currentCommercialTermId") REFERENCES "CommercialTerm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialTerm" ADD CONSTRAINT "CommercialTerm_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ClientAgencyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialTerm" ADD CONSTRAINT "CommercialTerm_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommercialTerm" ADD CONSTRAINT "CommercialTerm_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- BACKFILL: um termo por relação, a partir do cadastro atual
--
-- validFrom = entrada da relação (ou a criação do cliente, quando a
-- entrada não foi preenchida). validTo NULO = termo em vigor.
--
-- Só relações COM modalidade geram termo: a modalidade é obrigatória no
-- termo, e inventar MRR para quem nunca teve modalidade criaria valor
-- histórico falso. Quem está sem modalidade fica sem termo até alguém
-- informar — e a tela mostra isso, em vez de fingir.
-- =====================================================================
INSERT INTO "CommercialTerm" (
  "id", "relationshipId", "modality", "monthlyValue", "totalContractValue",
  "contractMonths", "validFrom", "validTo", "reason", "ownerId", "createdAt", "updatedAt"
)
SELECT
  'term_' || r."id",
  r."id",
  c."modality",
  c."monthlyValue",
  c."totalContractValue",
  c."contractMonths",
  COALESCE(r."startedAt", c."startedAt", c."createdAt"),
  NULL,
  'Migração do cadastro do v1 (F1.2)',
  r."ownerId",
  NOW(),
  NOW()
FROM "ClientAgencyRelationship" r
JOIN "Client" c ON c."id" = r."clientId"
WHERE c."modality" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- Cache do termo vigente na relação.
UPDATE "ClientAgencyRelationship" r
   SET "currentCommercialTermId" = t."id"
  FROM "CommercialTerm" t
 WHERE t."relationshipId" = r."id"
   AND t."validTo" IS NULL
   AND r."currentCommercialTermId" IS NULL;

