-- Identidade de mensageria: número de WhatsApp → usuário do workspace (28/09/2026).
-- ADITIVA: um enum e uma tabela nova; nenhuma tabela existente muda.

-- CreateEnum
CREATE TYPE "MessagingChannel" AS ENUM ('WHATSAPP');

-- CreateTable
CREATE TABLE "MessagingIdentity" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "MessagingChannel" NOT NULL,
    "externalIdentifier" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "deactivatedAt" TIMESTAMPTZ(3),
    "deactivatedById" TEXT,
    "lastResolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MessagingIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessagingIdentity_ownerId_channel_externalIdentifier_idx" ON "MessagingIdentity"("ownerId", "channel", "externalIdentifier");

-- CreateIndex
CREATE INDEX "MessagingIdentity_userId_idx" ON "MessagingIdentity"("userId");

-- AddForeignKey
ALTER TABLE "MessagingIdentity" ADD CONSTRAINT "MessagingIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- UM vínculo ATIVO por identificador em cada workspace (índice único
-- PARCIAL): desvincular desativa a linha, libera o número e preserva o
-- histórico. Dois usuários nunca respondem pelo mesmo telefone.
CREATE UNIQUE INDEX "MessagingIdentity_ativo_unico"
  ON "MessagingIdentity"("ownerId", "channel", "externalIdentifier")
  WHERE "isActive";

-- WhatsApp: só dígitos, com código do país (E.164 sem "+"): 10 a 15 dígitos.
ALTER TABLE "MessagingIdentity" ADD CONSTRAINT "MessagingIdentity_whatsapp_formato"
  CHECK ("channel" <> 'WHATSAPP' OR "externalIdentifier" ~ '^[1-9][0-9]{9,14}$');

-- Ativo ⇔ sem data de desativação.
ALTER TABLE "MessagingIdentity" ADD CONSTRAINT "MessagingIdentity_desativacao_coerente"
  CHECK ("isActive" = ("deactivatedAt" IS NULL));

-- F1.12: toda tabela nasce com RLS ligado.
ALTER TABLE "MessagingIdentity" ENABLE ROW LEVEL SECURITY;
