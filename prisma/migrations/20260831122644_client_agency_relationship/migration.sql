-- =====================================================================
-- F1.1 — CLIENT MESTRE + ClientAgencyRelationship (ref. 01 §4.3 e §3.9)
--
-- O Client passa a ser MESTRE (identidade, documento, contatos) e tudo que
-- é operacional migra para a RELAÇÃO com uma agência. Motivo prático: o
-- mesmo cliente pode estar ativo em duas agências com contratos, gestores
-- e cobranças distintos; com agencia_id no Client seria preciso cadastrar
-- a mesma empresa duas vezes — a duplicação que o dedupe da F1.16 combate.
--
-- O BACKFILL DESEMBARALHA O STATUS. O v1 tinha um campo só misturando
-- quatro dimensões que 01 §3.9 declara INDEPENDENTES:
--   RENEWAL     -> ciclo ACTIVE  + renovação NEGOTIATING
--   DELINQUENT  -> ciclo ACTIVE  + financeiro DELINQUENT
-- Um cliente inadimplente continua sendo cliente ativo; tratá-lo como um
-- estado de ciclo de vida foi a origem de metade das ambiguidades do v1.
-- Nada se perde: Client.status segue intacto como cache do legado.
--
-- Idempotente: ON CONFLICT na unique (clientId, agencyId), e o id da
-- relação é derivado do id do cliente — rodar duas vezes não duplica.
--
-- ATENÇÃO A QUEM GERAR A PRÓXIMA MIGRATION: o `prisma migrate dev` propôs
-- de novo um `DROP INDEX "User_workspaceOwnerId_idx"` — índice criado por
-- SQL cru em 20260723210000, invisível ao schema.prisma. Foi REMOVIDO
-- deste arquivo. O mesmo vale para "Billing_client_competence_mrr_key".
-- =====================================================================

-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('PROSPECT', 'ONBOARDING', 'ACTIVE', 'PAUSED', 'CHURNED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FinancialStatus" AS ENUM ('REGULAR', 'DUE_SOON', 'OVERDUE', 'DELINQUENT', 'WRITE_OFF');

-- CreateEnum
CREATE TYPE "RenewalStatus" AS ENUM ('NOT_APPLICABLE', 'UPCOMING', 'NEGOTIATING', 'RENEWED', 'LOST');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE', 'EXCEPTION');


-- AlterTable
ALTER TABLE "ClientLoss" ADD COLUMN     "relationshipId" TEXT;

-- AlterTable
ALTER TABLE "CollectionHistory" ADD COLUMN     "relationshipId" TEXT;

-- CreateTable
CREATE TABLE "ClientAgencyRelationship" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "lifecycleStatus" "LifecycleStatus" NOT NULL DEFAULT 'ACTIVE',
    "financialStatus" "FinancialStatus" NOT NULL DEFAULT 'REGULAR',
    "renewalStatus" "RenewalStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMPTZ(3),
    "pausedAt" TIMESTAMPTZ(3),
    "churnedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "currentCommercialTermId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClientAgencyRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvaliacaoMensal" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "estabilidade" TEXT,
    "ads" TEXT,
    "risco" TEXT,
    "upsell" TEXT,
    "observacao" TEXT,
    "gestores" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "confirmedAt" TIMESTAMPTZ(3),
    "confirmedBy" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AvaliacaoMensal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingTask" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "offsetDays" INTEGER,
    "dueAt" TIMESTAMPTZ(3),
    "doneAt" TIMESTAMPTZ(3),
    "doneBy" TEXT,
    "templateKey" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientAgencyRelationship_clientId_idx" ON "ClientAgencyRelationship"("clientId");

-- CreateIndex
CREATE INDEX "ClientAgencyRelationship_agencyId_idx" ON "ClientAgencyRelationship"("agencyId");

-- CreateIndex
CREATE INDEX "ClientAgencyRelationship_lifecycleStatus_idx" ON "ClientAgencyRelationship"("lifecycleStatus");

-- CreateIndex
CREATE INDEX "ClientAgencyRelationship_financialStatus_idx" ON "ClientAgencyRelationship"("financialStatus");

-- CreateIndex
CREATE INDEX "ClientAgencyRelationship_ownerId_idx" ON "ClientAgencyRelationship"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientAgencyRelationship_clientId_agencyId_key" ON "ClientAgencyRelationship"("clientId", "agencyId");

-- CreateIndex
CREATE INDEX "AvaliacaoMensal_competence_idx" ON "AvaliacaoMensal"("competence");

-- CreateIndex
CREATE INDEX "AvaliacaoMensal_ownerId_idx" ON "AvaliacaoMensal"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "AvaliacaoMensal_relationshipId_competence_key" ON "AvaliacaoMensal"("relationshipId", "competence");

-- CreateIndex
CREATE INDEX "OnboardingTask_relationshipId_idx" ON "OnboardingTask"("relationshipId");

-- CreateIndex
CREATE INDEX "OnboardingTask_dueAt_idx" ON "OnboardingTask"("dueAt");

-- CreateIndex
CREATE INDEX "OnboardingTask_ownerId_idx" ON "OnboardingTask"("ownerId");

-- CreateIndex
CREATE INDEX "ClientLoss_relationshipId_idx" ON "ClientLoss"("relationshipId");

-- CreateIndex
CREATE INDEX "CollectionHistory_relationshipId_idx" ON "CollectionHistory"("relationshipId");

-- AddForeignKey
ALTER TABLE "ClientLoss" ADD CONSTRAINT "ClientLoss_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ClientAgencyRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionHistory" ADD CONSTRAINT "CollectionHistory_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ClientAgencyRelationship"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAgencyRelationship" ADD CONSTRAINT "ClientAgencyRelationship_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAgencyRelationship" ADD CONSTRAINT "ClientAgencyRelationship_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAgencyRelationship" ADD CONSTRAINT "ClientAgencyRelationship_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvaliacaoMensal" ADD CONSTRAINT "AvaliacaoMensal_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ClientAgencyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvaliacaoMensal" ADD CONSTRAINT "AvaliacaoMensal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ClientAgencyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingTask" ADD CONSTRAINT "OnboardingTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- BACKFILL: uma relação por cliente com a agência mais antiga (B2C Gestão)
-- =====================================================================
INSERT INTO "ClientAgencyRelationship" (
  "id", "clientId", "agencyId",
  "lifecycleStatus", "financialStatus", "renewalStatus", "onboardingStatus",
  "startedAt", "churnedAt", "ownerId", "createdAt", "updatedAt"
)
SELECT
  'rel_' || c."id",
  c."id",
  (SELECT a."id" FROM "Agency" a ORDER BY a."createdAt" ASC, a."id" ASC LIMIT 1),
  CASE c."status"
    WHEN 'LEAD'       THEN 'PROSPECT'::"LifecycleStatus"
    WHEN 'PROSPECT'   THEN 'PROSPECT'::"LifecycleStatus"
    WHEN 'ACTIVE'     THEN 'ACTIVE'::"LifecycleStatus"
    WHEN 'INACTIVE'   THEN 'INACTIVE'::"LifecycleStatus"
    WHEN 'PAUSED'     THEN 'PAUSED'::"LifecycleStatus"
    WHEN 'RENEWAL'    THEN 'ACTIVE'::"LifecycleStatus"
    WHEN 'DELINQUENT' THEN 'ACTIVE'::"LifecycleStatus"
    WHEN 'CHURNED'    THEN 'CHURNED'::"LifecycleStatus"
    ELSE 'ACTIVE'::"LifecycleStatus"
  END,
  CASE WHEN c."status" = 'DELINQUENT'
       THEN 'DELINQUENT'::"FinancialStatus"
       ELSE 'REGULAR'::"FinancialStatus" END,
  CASE WHEN c."status" = 'RENEWAL'
       THEN 'NEGOTIATING'::"RenewalStatus"
       ELSE 'NOT_APPLICABLE'::"RenewalStatus" END,
  -- Onboarding de cliente que já vem da migração está concluído por
  -- definição: ele já opera. Marcar NOT_STARTED encheria o board de
  -- pendência falsa para 100% da carteira no primeiro dia.
  CASE WHEN c."status" IN ('LEAD','PROSPECT')
       THEN 'NOT_STARTED'::"OnboardingStatus"
       ELSE 'COMPLETE'::"OnboardingStatus" END,
  c."startedAt",
  c."churnedAt",
  c."ownerId",
  NOW(),
  NOW()
FROM "Client" c
WHERE EXISTS (SELECT 1 FROM "Agency")
ON CONFLICT ("clientId", "agencyId") DO NOTHING;

-- ClientLoss pertence à relação (01 §4.3).
UPDATE "ClientLoss" l
   SET "relationshipId" = r."id"
  FROM "ClientAgencyRelationship" r
 WHERE r."clientId" = l."clientId"
   AND l."relationshipId" IS NULL;

-- CollectionHistory idem, quando o cliente é conhecido.
UPDATE "CollectionHistory" h
   SET "relationshipId" = r."id"
  FROM "ClientAgencyRelationship" r
 WHERE r."clientId" = h."clientId"
   AND h."relationshipId" IS NULL;

