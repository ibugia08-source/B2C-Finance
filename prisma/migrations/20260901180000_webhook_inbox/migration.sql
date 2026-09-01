-- F4.8 — caixa de entrada de webhook (ref. 03 §4.2, §4.3; cenário S20).
--
-- Escrita à mão a partir de `prisma migrate diff`, sem as duas linhas de
-- DROP INDEX que o diff propõe a cada migration.
--
-- A UNIQUE de (source, eventId) É a idempotência de entrada. Todo provedor de
-- webhook reenvia quando não recebe 200 a tempo — é o comportamento correto
-- dele. Sem esta constraint, uma resposta lenta nossa vira um segundo fato
-- financeiro, e o cliente aparece com dois pagamentos que ele fez uma vez.



-- CreateTable
CREATE TABLE "WebhookInbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "note" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "WebhookInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebhookInbox_workspaceId_status_idx" ON "WebhookInbox"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WebhookInbox_eventType_idx" ON "WebhookInbox"("eventType");

-- CreateIndex
CREATE INDEX "WebhookInbox_receivedAt_idx" ON "WebhookInbox"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookInbox_source_eventId_key" ON "WebhookInbox"("source", "eventId");

-- AddForeignKey
ALTER TABLE "WebhookInbox" ADD CONSTRAINT "WebhookInbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "WebhookInbox" ADD CONSTRAINT "WebhookInbox_status_conhecido"
  CHECK ("status" IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED'));
-- Processado carimba a data; não processado não carimba.
ALTER TABLE "WebhookInbox" ADD CONSTRAINT "WebhookInbox_processado_com_data"
  CHECK (("status" = 'RECEIVED' AND "processedAt" IS NULL)
      OR ("status" <> 'RECEIVED' AND "processedAt" IS NOT NULL));

ALTER TABLE "WebhookInbox" ENABLE ROW LEVEL SECURITY;
