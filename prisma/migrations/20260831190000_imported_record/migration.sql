-- F1.21 · Proveniência de importação + fila de revisão (03 §3.3).
--
-- Uma linha por linha de planilha, para QUALQUER módulo. Uma tabela só, e não
-- quatro colunas em cada modelo importável: funciona para módulo que ainda não
-- existe, guarda a LINHA CRUA (que é o que um humano precisa para conferir), e
-- a fila de revisão vira uma consulta aqui em vez de mais um modelo.
--
-- Sem migração do v1 (decisão 19.32), sourceSystem é sempre PLANILHA hoje.
--
-- Os DROP INDEX que o prisma migrate diff propõe (User_workspaceOwnerId_idx e
-- User_scopeAgencyId_idx) FORAM REMOVIDOS: o primeiro nasceu de SQL cru em
-- 20260723210000 e é invisível ao schema.prisma; o segundo é da migration
-- 20260831170000, criado com CREATE INDEX IF NOT EXISTS pelo mesmo motivo.
-- Nenhum dos dois sobra.

CREATE TABLE "ImportedRecord" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "sourceRow" INTEGER NOT NULL,
    "sourceSystem" TEXT NOT NULL DEFAULT 'PLANILHA',
    "confidence" INTEGER NOT NULL DEFAULT 100,
    "raw" JSONB NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'OK',
    "reviewReason" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedBy" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportedRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportedRecord_batchId_idx" ON "ImportedRecord"("batchId");
CREATE INDEX "ImportedRecord_entity_entityId_idx" ON "ImportedRecord"("entity", "entityId");
CREATE INDEX "ImportedRecord_reviewStatus_idx" ON "ImportedRecord"("reviewStatus");
CREATE INDEX "ImportedRecord_ownerId_idx" ON "ImportedRecord"("ownerId");

ALTER TABLE "ImportedRecord" ADD CONSTRAINT "ImportedRecord_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportedRecord" ADD CONSTRAINT "ImportedRecord_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Só os quatro estados previstos; qualquer outro é bug entrando calado.
ALTER TABLE "ImportedRecord" ADD CONSTRAINT "ImportedRecord_reviewStatus_valido"
  CHECK ("reviewStatus" IN ('OK', 'PENDENTE', 'RESOLVIDO', 'DESCARTADO'));
ALTER TABLE "ImportedRecord" ADD CONSTRAINT "ImportedRecord_confidence_faixa"
  CHECK ("confidence" BETWEEN 0 AND 100);

-- F1.12: RLS em toda tabela privada. A tabela nasce protegida — foi
-- exatamente o esquecimento que a auditoria de 31/08 achou em 23 tabelas.
-- SEM FORCE, de propósito: o Prisma conecta como DONA da tabela, e FORCE
-- aplicaria o RLS também à dona — com zero policies, isso derrubaria o app
-- inteiro nesta tabela. O que o ENABLE bloqueia é a API pública do Supabase
-- (anon/authenticated), que é o alvo real. Mesmo padrão da 20260831160000.
ALTER TABLE "ImportedRecord" ENABLE ROW LEVEL SECURITY;
