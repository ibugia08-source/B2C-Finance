-- F4.1 — COMERCIAL: LEAD, OPORTUNIDADE, FUNIL E ATIVIDADE (ref. 01 §4.6)
--
-- Escrita à mão a partir de `prisma migrate diff`, sem as duas linhas de
-- DROP INDEX que o diff propõe a cada migration (índices de User criados à
-- mão que o datamodel não declara).

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'SCHEDULED', 'CONVERTED', 'LOST');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('LIGACAO', 'ABORDAGEM', 'REUNIAO', 'NO_SHOW', 'PROPOSTA', 'OUTRO');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('NOVA', 'QUALIFICACAO', 'REUNIAO', 'PROPOSTA', 'NEGOCIACAO', 'GANHA', 'PERDIDA');



-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "document" TEXT,
    "documentDigits" TEXT,
    "niche" TEXT,
    "agencyId" TEXT,
    "channel" TEXT,
    "campaign" TEXT,
    "source" TEXT,
    "sdr" TEXT,
    "indicadoPor" TEXT,
    "solicitadoPor" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "lostReason" TEXT,
    "convertedClientId" TEXT,
    "convertedAt" TIMESTAMPTZ(3),
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL,
    "type" "InteractionType" NOT NULL,
    "leadId" TEXT,
    "opportunityId" TEXT,
    "clientId" TEXT,
    "happenedAt" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "createdBy" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Interaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "leadId" TEXT,
    "clientId" TEXT,
    "agencyId" TEXT,
    "closer" TEXT,
    "offerId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "modality" "ClientModality" NOT NULL DEFAULT 'MRR',
    "months" INTEGER,
    "stage" "OpportunityStage" NOT NULL DEFAULT 'NOVA',
    "expectedCloseAt" TIMESTAMPTZ(3),
    "wonAt" TIMESTAMPTZ(3),
    "lostAt" TIMESTAMPTZ(3),
    "lostReason" TEXT,
    "createdClientId" TEXT,
    "createdContractId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineEvent" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "fromStage" "OpportunityStage",
    "toStage" "OpportunityStage" NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedBy" TEXT,
    "reason" TEXT,
    "ownerId" TEXT,

    CONSTRAINT "PipelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AtividadeDiaria" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMPTZ(3) NOT NULL,
    "sdr" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL DEFAULT '',
    "ligacoes" INTEGER NOT NULL DEFAULT 0,
    "abordagens" INTEGER NOT NULL DEFAULT 0,
    "agendamentos" INTEGER NOT NULL DEFAULT 0,
    "reunioesRealizadas" INTEGER NOT NULL DEFAULT 0,
    "noShows" INTEGER NOT NULL DEFAULT 0,
    "propostas" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AtividadeDiaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GastoAdsDiario" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMPTZ(3) NOT NULL,
    "agencyId" TEXT NOT NULL DEFAULT '',
    "platform" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GastoAdsDiario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_documentDigits_idx" ON "Lead"("documentDigits");

-- CreateIndex
CREATE INDEX "Lead_agencyId_idx" ON "Lead"("agencyId");

-- CreateIndex
CREATE INDEX "Lead_sdr_idx" ON "Lead"("sdr");

-- CreateIndex
CREATE INDEX "Lead_ownerId_idx" ON "Lead"("ownerId");

-- CreateIndex
CREATE INDEX "Interaction_leadId_idx" ON "Interaction"("leadId");

-- CreateIndex
CREATE INDEX "Interaction_opportunityId_idx" ON "Interaction"("opportunityId");

-- CreateIndex
CREATE INDEX "Interaction_clientId_idx" ON "Interaction"("clientId");

-- CreateIndex
CREATE INDEX "Interaction_type_happenedAt_idx" ON "Interaction"("type", "happenedAt");

-- CreateIndex
CREATE INDEX "Interaction_ownerId_idx" ON "Interaction"("ownerId");

-- CreateIndex
CREATE INDEX "Opportunity_stage_idx" ON "Opportunity"("stage");

-- CreateIndex
CREATE INDEX "Opportunity_agencyId_idx" ON "Opportunity"("agencyId");

-- CreateIndex
CREATE INDEX "Opportunity_closer_idx" ON "Opportunity"("closer");

-- CreateIndex
CREATE INDEX "Opportunity_leadId_idx" ON "Opportunity"("leadId");

-- CreateIndex
CREATE INDEX "Opportunity_ownerId_idx" ON "Opportunity"("ownerId");

-- CreateIndex
CREATE INDEX "PipelineEvent_opportunityId_changedAt_idx" ON "PipelineEvent"("opportunityId", "changedAt");

-- CreateIndex
CREATE INDEX "PipelineEvent_toStage_idx" ON "PipelineEvent"("toStage");

-- CreateIndex
CREATE INDEX "PipelineEvent_ownerId_idx" ON "PipelineEvent"("ownerId");

-- CreateIndex
CREATE INDEX "AtividadeDiaria_date_idx" ON "AtividadeDiaria"("date");

-- CreateIndex
CREATE INDEX "AtividadeDiaria_sdr_idx" ON "AtividadeDiaria"("sdr");

-- CreateIndex
CREATE INDEX "AtividadeDiaria_ownerId_idx" ON "AtividadeDiaria"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "AtividadeDiaria_date_sdr_agencyId_key" ON "AtividadeDiaria"("date", "sdr", "agencyId");

-- CreateIndex
CREATE INDEX "GastoAdsDiario_date_idx" ON "GastoAdsDiario"("date");

-- CreateIndex
CREATE INDEX "GastoAdsDiario_ownerId_idx" ON "GastoAdsDiario"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "GastoAdsDiario_date_agencyId_platform_key" ON "GastoAdsDiario"("date", "agencyId", "platform");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_convertedClientId_fkey" FOREIGN KEY ("convertedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interaction" ADD CONSTRAINT "Interaction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineEvent" ADD CONSTRAINT "PipelineEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineEvent" ADD CONSTRAINT "PipelineEvent_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeDiaria" ADD CONSTRAINT "AtividadeDiaria_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AtividadeDiaria" ADD CONSTRAINT "AtividadeDiaria_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoAdsDiario" ADD CONSTRAINT "GastoAdsDiario_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GastoAdsDiario" ADD CONSTRAINT "GastoAdsDiario_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- INVARIANTES QUE O BANCO CONSEGUE GARANTIR SOZINHO
-- ===========================================================================

-- Só dígitos no campo de deduplicação. É ele que a conversão consulta
-- (01 §4.6); um "12.345.678/0001-99" guardado aqui faria o mesmo CNPJ virar
-- dois clientes — o duplicado nasce e ninguém percebe.
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_documentDigits_so_digitos"
  CHECK ("documentDigits" IS NULL OR "documentDigits" ~ '^[0-9]+$');

-- Lead convertido tem cliente e data; lead não convertido não tem nenhum dos
-- dois. Meia conversão é o estado em que o lead some do funil sem virar
-- cliente em lugar nenhum.
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_conversao_coerente"
  CHECK (
    ("status" <> 'CONVERTED' AND "convertedAt" IS NULL)
    OR ("status" = 'CONVERTED' AND "convertedAt" IS NOT NULL AND "convertedClientId" IS NOT NULL)
  );

-- Perda exige motivo. "Perdemos" sem porquê não vira aprendizado nenhum, e é
-- a informação que o comercial mais procura três meses depois.
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_perda_com_motivo"
  CHECK ("status" <> 'LOST' OR length(trim(coalesce("lostReason", ''))) >= 3);
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_perda_com_motivo"
  CHECK ("stage" <> 'PERDIDA' OR length(trim(coalesce("lostReason", ''))) >= 3);

-- Etapa terminal carimba a data; etapa em andamento não carimba nenhuma.
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_terminal_com_data"
  CHECK (
    ("stage" = 'GANHA' AND "wonAt" IS NOT NULL AND "lostAt" IS NULL)
    OR ("stage" = 'PERDIDA' AND "lostAt" IS NOT NULL AND "wonAt" IS NULL)
    OR ("stage" NOT IN ('GANHA', 'PERDIDA') AND "wonAt" IS NULL AND "lostAt" IS NULL)
  );

ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_valor_positivo"
  CHECK ("amount" >= 0);

-- Um evento de funil que não muda nada é ruído que estraga o tempo por etapa.
ALTER TABLE "PipelineEvent" ADD CONSTRAINT "PipelineEvent_mudou_de_etapa"
  CHECK ("fromStage" IS NULL OR "fromStage" <> "toStage");

-- Contagem de atividade não é negativa.
ALTER TABLE "AtividadeDiaria" ADD CONSTRAINT "AtividadeDiaria_nao_negativa"
  CHECK ("ligacoes" >= 0 AND "abordagens" >= 0 AND "agendamentos" >= 0
     AND "reunioesRealizadas" >= 0 AND "noShows" >= 0 AND "propostas" >= 0);

ALTER TABLE "GastoAdsDiario" ADD CONSTRAINT "GastoAdsDiario_valor_positivo"
  CHECK ("amount" >= 0);
ALTER TABLE "GastoAdsDiario" ADD CONSTRAINT "GastoAdsDiario_plataforma_conhecida"
  CHECK ("platform" IN ('meta', 'google', 'tiktok', 'outro'));

-- F1.12: RLS em toda tabela privada. SEM FORCE (o Prisma conecta como dona).
ALTER TABLE "Lead" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Interaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Opportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PipelineEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AtividadeDiaria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GastoAdsDiario" ENABLE ROW LEVEL SECURITY;
