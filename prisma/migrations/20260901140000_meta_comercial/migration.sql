-- F4.3/F4.5 — META COMERCIAL (ref. 02 §5.4)
--
-- Escrita à mão a partir de `prisma migrate diff`, sem as duas linhas de
-- DROP INDEX que o diff propõe a cada migration.



-- CreateTable
CREATE TABLE "CommercialGoal" (
    "id" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "metric" TEXT NOT NULL,
    "target" DECIMAL(14,2) NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CommercialGoal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommercialGoal_competence_idx" ON "CommercialGoal"("competence");

-- CreateIndex
CREATE INDEX "CommercialGoal_ownerId_idx" ON "CommercialGoal"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "CommercialGoal_competence_scopeType_scopeId_metric_key" ON "CommercialGoal"("competence", "scopeType", "scopeId", "metric");

-- AddForeignKey
ALTER TABLE "CommercialGoal" ADD CONSTRAINT "CommercialGoal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


ALTER TABLE "CommercialGoal" ADD CONSTRAINT "CommercialGoal_competence_formato"
  CHECK ("competence" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "CommercialGoal" ADD CONSTRAINT "CommercialGoal_escopo_conhecido"
  CHECK ("scopeType" IN ('AGENCY', 'SDR', 'CLOSER', 'GESTOR'));
-- Meta zero ou negativa não é meta: é a métrica desligada, e desligar se faz
-- apagando a linha.
ALTER TABLE "CommercialGoal" ADD CONSTRAINT "CommercialGoal_alvo_positivo"
  CHECK ("target" > 0);

ALTER TABLE "CommercialGoal" ENABLE ROW LEVEL SECURITY;
