-- =====================================================================
-- F0.7 — REGISTRY DE MÉTRICAS (ref. 01 §7; 03 §4.1)
--
-- Métrica é contrato VERSIONADO: fórmula, fontes, grão, base temporal,
-- arredondamento e política de nulo. Quando uma fórmula mudar, nasce a versão
-- 2 e o snapshot antigo segue reportando a versão que usou (cenário S22).
--
-- O conteúdo vive em src/lib/metrics/registry.ts (fonte única de seed e
-- testes) e é gravado por prisma/seed-metric-registry.ts.
--
-- DROP INDEX de drift removido de novo.
-- =====================================================================

-- CreateEnum
CREATE TYPE "MetricGrain" AS ENUM ('COMPETENCE', 'PERIOD', 'POINT_IN_TIME', 'CLIENT');

-- CreateEnum
CREATE TYPE "MetricDateBasis" AS ENUM ('COMPETENCE', 'CASH', 'CURRENT_STATE', 'SNAPSHOT');

-- CreateTable
CREATE TABLE "MetricDefinition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "formulaDescription" TEXT NOT NULL,
    "grain" "MetricGrain" NOT NULL,
    "dateBasis" "MetricDateBasis" NOT NULL,
    "sourceEntities" TEXT[],
    "filters" TEXT,
    "rounding" TEXT NOT NULL DEFAULT 'half-up 2 casas',
    "nullPolicy" TEXT NOT NULL DEFAULT 'denominador zero → null (exibe —)',
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MetricDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MetricDefinition_workspaceId_idx" ON "MetricDefinition"("workspaceId");

-- CreateIndex
CREATE INDEX "MetricDefinition_key_idx" ON "MetricDefinition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "MetricDefinition_workspaceId_key_version_key" ON "MetricDefinition"("workspaceId", "key", "version");

-- AddForeignKey
ALTER TABLE "MetricDefinition" ADD CONSTRAINT "MetricDefinition_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
