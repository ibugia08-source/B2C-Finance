-- =====================================================================
-- POSSE DO EVENTO NA CAIXA DE ENTRADA (correção de concorrência)
--
-- A unique de (source, eventId) protege a LINHA, não o PROCESSAMENTO. Dez
-- entregas simultâneas do mesmo evento: uma insere a linha e as outras nove
-- batiam na unique, liam o status ainda "RECEIVED", concluíam "não houve
-- desfecho" e aplicavam o mesmo fato outra vez — dez leads do mesmo lead.
--
-- O estado PROCESSANDO separa "ninguém pegou este evento" de "alguém está
-- com ele agora". Quem INSERE a linha já nasce dono; quem chega depois só
-- assume o trabalho com um UPDATE condicional (atômico no Postgres) e,
-- quando não consegue, responde repetido — o dono legítimo chega ao
-- desfecho. Linha PROCESSANDO velha volta a ser reivindicável: é o processo
-- que morreu segurando o evento.
--
-- O invariante antigo continua: sem desfecho não carimba data.
-- =====================================================================

ALTER TABLE "WebhookInbox" DROP CONSTRAINT "WebhookInbox_status_conhecido";
ALTER TABLE "WebhookInbox" ADD CONSTRAINT "WebhookInbox_status_conhecido"
  CHECK ("status" IN ('RECEIVED', 'PROCESSANDO', 'PROCESSED', 'IGNORED', 'FAILED'));

ALTER TABLE "WebhookInbox" DROP CONSTRAINT "WebhookInbox_processado_com_data";
ALTER TABLE "WebhookInbox" ADD CONSTRAINT "WebhookInbox_processado_com_data"
  CHECK (("status" IN ('RECEIVED', 'PROCESSANDO') AND "processedAt" IS NULL)
      OR ("status" NOT IN ('RECEIVED', 'PROCESSANDO') AND "processedAt" IS NOT NULL));
