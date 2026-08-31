-- =====================================================================
-- F1.9 — TRILHA DE AUDITORIA append-only (01 §4.10)
--
-- Campo a campo, e não um JSON do registro inteiro: a pergunta real nunca é
-- "como estava o cliente em março?" e sim "QUEM mudou o valor, QUANDO e POR
-- QUÊ?". Guardar o objeto todo obriga a diferenciar dois JSONs para
-- responder isso, e ninguém faz isso na hora da dúvida.
--
-- DROP INDEX de drift removido do diff.
-- =====================================================================

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'REVERSE');

-- CreateEnum
CREATE TYPE "AuditOrigin" AS ENUM ('UI', 'IMPORT', 'JOB', 'API', 'MIGRATION');


-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "field" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "origin" "AuditOrigin" NOT NULL DEFAULT 'UI',
    "reason" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "correlationId" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorEmail_idx" ON "AuditLog"("actorEmail");

-- CreateIndex
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- CreateIndex
CREATE INDEX "AuditLog_ownerId_idx" ON "AuditLog"("ownerId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- APPEND-ONLY DE VERDADE: a regra mora no BANCO.
--
-- Trilha que o próprio sistema pode reescrever não é trilha, é rascunho.
-- O gatilho recusa UPDATE e DELETE na tabela para QUALQUER caminho —
-- aplicação, script, psql. Correção de trilha se faz acrescentando uma
-- linha nova, nunca apagando a errada.
--
-- Expurgo por retenção, quando existir, será uma migration explícita que
-- desativa o gatilho, apaga a janela e o religa — visível na revisão.
-- =====================================================================
CREATE OR REPLACE FUNCTION b2c_audit_log_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog e append-only: % nao e permitido (01 4.10). Registre uma linha nova.', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_append_only ON "AuditLog";
CREATE TRIGGER trg_audit_log_append_only
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION b2c_audit_log_append_only();

