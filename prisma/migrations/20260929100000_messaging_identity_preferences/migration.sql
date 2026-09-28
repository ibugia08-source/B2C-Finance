-- Fase 16 · bloco 2 (Telegram): preferências de envio por vínculo de canal.
-- ADITIVA: três colunas novas com padrão "desligado"; nenhum dado existente muda.
ALTER TABLE "MessagingIdentity" ADD COLUMN IF NOT EXISTS "receiveMorningReport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MessagingIdentity" ADD COLUMN IF NOT EXISTS "receiveEveningReport" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "MessagingIdentity" ADD COLUMN IF NOT EXISTS "notificationEvents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
