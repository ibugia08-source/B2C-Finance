-- API oficial (/api/v1): contas de serviço (28/09/2026).
-- ADITIVA: cria dois enums e uma tabela nova. Nenhuma tabela existente é
-- alterada, nenhum dado é tocado. Ver docs/API_AUTHENTICATION.md.

-- CreateEnum
CREATE TYPE "ServiceAccountType" AS ENUM ('INTEGRATION');

-- CreateEnum
CREATE TYPE "ServiceAccountStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "ServiceAccount" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" "ServiceAccountType" NOT NULL DEFAULT 'INTEGRATION',
    "status" "ServiceAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" TEXT,
    "rotatedAt" TIMESTAMPTZ(3),
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ServiceAccount_pkey" PRIMARY KEY ("id"),
    -- O hash é SHA-256 em hex: 64 caracteres. Qualquer outra coisa (ex.: o
    -- token puro gravado por engano) é recusada pelo banco.
    CONSTRAINT "ServiceAccount_tokenHash_sha256" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
    -- Revogada ⇔ tem data de revogação.
    CONSTRAINT "ServiceAccount_revogacao_coerente" CHECK (("status" = 'REVOKED') = ("revokedAt" IS NOT NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceAccount_tokenPrefix_key" ON "ServiceAccount"("tokenPrefix");

-- CreateIndex
CREATE INDEX "ServiceAccount_ownerId_status_idx" ON "ServiceAccount"("ownerId", "status");

-- F1.12: toda tabela nasce com RLS ligado (sem policy = só o dono da tabela).
ALTER TABLE "ServiceAccount" ENABLE ROW LEVEL SECURITY;
