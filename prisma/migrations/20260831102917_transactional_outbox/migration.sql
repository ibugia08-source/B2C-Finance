-- =====================================================================
-- F0.10 — TRANSACTIONAL OUTBOX (ref. 03 §4.2; 01 §2.20)
--
-- Integração externa fora da atomicidade financeira. O fato, o razão, a
-- auditoria e o evento de saída entram na MESMA transação; a entrega roda
-- depois, por um worker com recuo exponencial e dead-letter.
--
-- Sem consumidores nesta fase, como manda a tarefa: o que existe é o
-- mecanismo (publicar dentro da transação, entregar fora).
--
-- DROP INDEX de drift removido de novo.
-- =====================================================================

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DELIVERED', 'DEAD_LETTER', 'CANCELED');

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMPTZ(3),
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_workspaceId_status_idx" ON "OutboxEvent"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "OutboxEvent_sourceType_sourceId_idx" ON "OutboxEvent"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_workspaceId_dedupeKey_key" ON "OutboxEvent"("workspaceId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "OutboxEvent" ADD CONSTRAINT "OutboxEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
