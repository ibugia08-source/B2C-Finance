-- F3.6 · Registro OPCIONAL de nota fiscal (01 §4.7).
--
-- DECIDIDO 19.38 (31/08): a maioria dos serviços prestados NÃO gera nota, e a
-- direção decidiu deixar isso em aberto, sem exigência de CNPJ. Este modelo é
-- um REGISTRO do que foi emitido por fora, não um emissor: nenhuma regra gera
-- pendência e nada trava por falta de nota.
--
-- Registrar tem um uso concreto mesmo assim: quando o contador pergunta "qual
-- nota corresponde a este recebimento?", a resposta existe — em vez de a
-- conferência virar caça ao e-mail.
--
-- DROP INDEX de drift removido (ver 20260723210000).

-- CreateEnum
CREATE TYPE "FiscalDocumentStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED', 'REPLACED');



-- CreateTable
CREATE TABLE "FiscalDocument" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT,
    "clientId" TEXT,
    "billingId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'NFSe',
    "number" TEXT NOT NULL,
    "series" TEXT,
    "accessKey" TEXT,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "FiscalDocumentStatus" NOT NULL DEFAULT 'ISSUED',
    "cancelledAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FiscalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FiscalDocument_billingId_idx" ON "FiscalDocument"("billingId");

-- CreateIndex
CREATE INDEX "FiscalDocument_clientId_idx" ON "FiscalDocument"("clientId");

-- CreateIndex
CREATE INDEX "FiscalDocument_issuedAt_idx" ON "FiscalDocument"("issuedAt");

-- CreateIndex
CREATE INDEX "FiscalDocument_ownerId_idx" ON "FiscalDocument"("ownerId");

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_billingId_fkey" FOREIGN KEY ("billingId") REFERENCES "Billing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Número de nota vazio é registro que não serve para conferir nada.
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_numero_obrigatorio"
  CHECK (length(btrim("number")) > 0);
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_valor_positivo"
  CHECK ("amount" > 0);
-- Cancelada tem de ter data de cancelamento; sem ela ninguém sabe quando
-- o valor deixou de valer.
ALTER TABLE "FiscalDocument" ADD CONSTRAINT "FiscalDocument_cancelamento_datado"
  CHECK ("status" <> 'CANCELLED' OR "cancelledAt" IS NOT NULL);

ALTER TABLE "FiscalDocument" ENABLE ROW LEVEL SECURITY;
