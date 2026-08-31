-- =====================================================================
-- F0.5 — ENTIDADE LEGAL × AGÊNCIA (ref. 01 §4.2)
--
-- EntidadeLegal é o CNPJ (emissão fiscal, contas bancárias, passivos
-- tributários, exportação do contador). Agência é a unidade de negócio.
-- Várias agências podem compartilhar a mesma EntidadeLegal.
--
-- Padrão de setup: 1 EntidadeLegal = 1 Agência espelhadas, semeadas ao fim
-- desta migration para o workspace existente (B2C Gestão). O CNPJ fica NULO
-- de propósito — preenchê-lo depende da DECISÃO 19.15 (quais CNPJs reais e
-- a que entidade cada agência pertence), ainda em aberto.
--
-- Lembrete: o `prisma migrate dev` propôs de novo o DROP INDEX de
-- "User_workspaceOwnerId_idx" (criado por SQL cru em 20260723210000).
-- Removido daqui. O mesmo vale para "Billing_client_competence_mrr_key".
-- =====================================================================

-- CreateTable
CREATE TABLE "LegalEntity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "cnpj" TEXT,
    "taxRegime" TEXT,
    "registrations" JSONB,
    "timezone" TEXT NOT NULL DEFAULT 'America/Bahia',
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "taxSettings" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LegalEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EconomicGroup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EconomicGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalEntity_workspaceId_idx" ON "LegalEntity"("workspaceId");

-- CreateIndex
CREATE INDEX "LegalEntity_active_idx" ON "LegalEntity"("active");

-- CreateIndex
CREATE UNIQUE INDEX "LegalEntity_workspaceId_cnpj_key" ON "LegalEntity"("workspaceId", "cnpj");

-- CreateIndex
CREATE INDEX "Agency_workspaceId_idx" ON "Agency"("workspaceId");

-- CreateIndex
CREATE INDEX "Agency_legalEntityId_idx" ON "Agency"("legalEntityId");

-- CreateIndex
CREATE INDEX "Agency_active_idx" ON "Agency"("active");

-- CreateIndex
CREATE UNIQUE INDEX "Agency_workspaceId_slug_key" ON "Agency"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "EconomicGroup_workspaceId_idx" ON "EconomicGroup"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "EconomicGroup_workspaceId_name_key" ON "EconomicGroup"("workspaceId", "name");

-- AddForeignKey
ALTER TABLE "LegalEntity" ADD CONSTRAINT "LegalEntity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EconomicGroup" ADD CONSTRAINT "EconomicGroup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =====================================================================
-- SEED: 1 EntidadeLegal = 1 Agência espelhadas para o workspace atual
-- =====================================================================
INSERT INTO "LegalEntity" ("id", "workspaceId", "legalName", "tradeName", "timezone", "currency", "active", "createdAt", "updatedAt")
SELECT 'le_' || substr(md5(w."id"), 1, 21), w."id", 'B2C Gestão', 'B2C Gestão', w."timezone", w."currency", TRUE, NOW(), NOW()
FROM "Workspace" w
WHERE NOT EXISTS (SELECT 1 FROM "LegalEntity" le WHERE le."workspaceId" = w."id");

INSERT INTO "Agency" ("id", "workspaceId", "legalEntityId", "name", "slug", "color", "active", "createdAt", "updatedAt")
SELECT 'ag_' || substr(md5(le."id"), 1, 21), le."workspaceId", le."id", 'B2C Gestão', 'b2c-gestao', '#1E70D3', TRUE, NOW(), NOW()
FROM "LegalEntity" le
WHERE NOT EXISTS (SELECT 1 FROM "Agency" a WHERE a."workspaceId" = le."workspaceId");
