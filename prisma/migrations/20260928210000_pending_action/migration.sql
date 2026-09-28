-- Ações pendentes do agente (escrita com confirmação pelo WhatsApp) — 28/09/2026.
-- ADITIVA: um enum e uma tabela nova; nenhuma tabela existente muda.

-- CreateEnum
CREATE TYPE "PendingActionStatus" AS ENUM ('PENDING', 'EXECUTING', 'EXECUTED', 'FAILED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "PendingAction" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identityId" TEXT NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "channel" "MessagingChannel" NOT NULL,
    "operation" TEXT NOT NULL,
    "targetId" TEXT,
    "payload" JSONB NOT NULL,
    "preview" TEXT NOT NULL,
    "summary" JSONB,
    "stateFingerprint" TEXT NOT NULL,
    "confirmationCode" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "status" "PendingActionStatus" NOT NULL DEFAULT 'PENDING',
    "sourceMessageId" TEXT,
    "confirmationMessageId" TEXT,
    "idempotencyKey" TEXT,
    "result" JSONB,
    "errorCode" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "executedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PendingAction_ownerId_userId_channel_status_idx" ON "PendingAction"("ownerId", "userId", "channel", "status");

-- CreateIndex
CREATE INDEX "PendingAction_ownerId_sourceMessageId_idx" ON "PendingAction"("ownerId", "sourceMessageId");

-- CreateIndex
CREATE INDEX "PendingAction_createdAt_idx" ON "PendingAction"("createdAt");

-- AddForeignKey
ALTER TABLE "PendingAction" ADD CONSTRAINT "PendingAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- UMA ação aguardando confirmação por usuário e canal (índice único PARCIAL):
-- "SIM 4821" nunca fica ambíguo entre duas propostas. Uma proposta nova
-- substitui a anterior (SUPERSEDED) na mesma transação.
CREATE UNIQUE INDEX "PendingAction_uma_pendente"
  ON "PendingAction"("ownerId", "userId", "channel")
  WHERE "status" = 'PENDING';

-- Código de confirmação: 4 dígitos.
ALTER TABLE "PendingAction" ADD CONSTRAINT "PendingAction_codigo_formato"
  CHECK ("confirmationCode" ~ '^[0-9]{4}$');

-- F1.12: toda tabela nasce com RLS ligado.
ALTER TABLE "PendingAction" ENABLE ROW LEVEL SECURITY;
