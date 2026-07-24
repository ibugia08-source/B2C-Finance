-- Formulário público de contratos (substitui a feature paga do ZapSign):
-- link por modelo (/f/{token}) onde o cliente responde as variáveis e o
-- contrato é gerado dentro da plataforma. Aditiva e retrocompatível.

-- CreateTable
CREATE TABLE "ContractFormLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "clientId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "submissions" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractFormLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractFormLink_token_key" ON "ContractFormLink"("token");

-- CreateIndex
CREATE INDEX "ContractFormLink_templateId_idx" ON "ContractFormLink"("templateId");

-- AlterTable
ALTER TABLE "GeneratedContract" ADD COLUMN "formLinkId" TEXT;

-- AddForeignKey
ALTER TABLE "ContractFormLink" ADD CONSTRAINT "ContractFormLink_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ContractTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractFormLink" ADD CONSTRAINT "ContractFormLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedContract" ADD CONSTRAINT "GeneratedContract_formLinkId_fkey" FOREIGN KEY ("formLinkId") REFERENCES "ContractFormLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (regra da SPEC §4): app acessa via role dona; API pública do Supabase
-- não enxerga a tabela.
ALTER TABLE "ContractFormLink" ENABLE ROW LEVEL SECURITY;
