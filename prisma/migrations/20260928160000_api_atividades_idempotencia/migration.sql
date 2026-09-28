-- API: atividades (trilha por chamada, com retenção) e Idempotency-Key (28/09/2026).
-- ADITIVA: quatro enums e duas tabelas novas; nenhuma tabela existente muda.
-- Ver docs/API_AUDIT_IDEMPOTENCY.md.

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('WEB', 'API', 'N8N', 'WHATSAPP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('READ', 'WRITE');

-- CreateEnum
CREATE TYPE "ActivityResult" AS ENUM ('SUCCESS', 'ERROR', 'DENIED', 'REPLAYED');

-- CreateEnum
CREATE TYPE "IdempotencyState" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "ApiActivity" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "serviceAccountId" TEXT,
    "actorUserId" TEXT,
    "source" "ActivitySource" NOT NULL,
    "kind" "ActivityKind" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "requestId" TEXT NOT NULL,
    "correlationId" TEXT,
    "result" "ActivityResult" NOT NULL,
    "httpStatus" INTEGER NOT NULL,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiIdempotencyKey" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "state" "IdempotencyState" NOT NULL DEFAULT 'IN_PROGRESS',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ApiIdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiActivity_ownerId_createdAt_idx" ON "ApiActivity"("ownerId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ApiActivity_ownerId_kind_createdAt_idx" ON "ApiActivity"("ownerId", "kind", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ApiActivity_serviceAccountId_createdAt_idx" ON "ApiActivity"("serviceAccountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ApiActivity_requestId_idx" ON "ApiActivity"("requestId");

-- CreateIndex
CREATE INDEX "ApiActivity_kind_createdAt_idx" ON "ApiActivity"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "ApiIdempotencyKey_expiresAt_idx" ON "ApiIdempotencyKey"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiIdempotencyKey_serviceAccountId_key_key" ON "ApiIdempotencyKey"("serviceAccountId", "key");


-- Coerência: chave concluída tem resposta; em andamento, não.
ALTER TABLE "ApiIdempotencyKey" ADD CONSTRAINT "ApiIdempotencyKey_estado_coerente"
  CHECK (("state" = 'COMPLETED') = ("responseStatus" IS NOT NULL AND "completedAt" IS NOT NULL));
-- Chave: 1 a 255 caracteres seguros (ex.: wa_message_3EB0C4…).
ALTER TABLE "ApiIdempotencyKey" ADD CONSTRAINT "ApiIdempotencyKey_formato"
  CHECK ("key" ~ '^[A-Za-z0-9._:-]{1,255}$');

-- F1.12: toda tabela nasce com RLS ligado (sem policy = só o dono da tabela).
ALTER TABLE "ApiActivity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiIdempotencyKey" ENABLE ROW LEVEL SECURITY;
