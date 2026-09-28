-- Telegram como canal de mensageria (Fase 16, 29/09/2026).
-- ADITIVA: um valor novo no enum, uma coluna opcional e uma checagem de
-- formato que só vale para o canal novo. Nenhum dado existente muda.

-- Canal novo.
ALTER TYPE "MessagingChannel" ADD VALUE IF NOT EXISTS 'TELEGRAM';

-- Dados de exibição (Telegram: username, nome). Nunca usados como identidade.
ALTER TABLE "MessagingIdentity" ADD COLUMN "metadata" JSONB;

-- Telegram: o identificador é o Telegram User ID (inteiro positivo), nunca o
-- @username (que o usuário pode trocar). Compara como TEXTO de propósito: o
-- valor novo do enum não pode ser usado na mesma transação que o criou.
ALTER TABLE "MessagingIdentity" ADD CONSTRAINT "MessagingIdentity_telegram_formato"
  CHECK ("channel"::text <> 'TELEGRAM' OR "externalIdentifier" ~ '^[1-9][0-9]{0,15}$');
