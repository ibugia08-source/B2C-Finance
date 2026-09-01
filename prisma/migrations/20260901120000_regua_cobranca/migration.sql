-- F3.9 — RÉGUA DE COBRANÇA EM MODO TAREFA (ref. 02 §4.3)
--
-- Escrita à mão a partir de `prisma migrate diff`, sem as duas linhas de
-- DROP INDEX que o diff insiste em propor (índices de User criados à mão).

ALTER TABLE "Client"
  ADD COLUMN "collectionBlockReason" TEXT,
  ADD COLUMN "collectionOptOut" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "collectionSilenceUntil" TIMESTAMPTZ(3);

ALTER TABLE "CollectionHistory" ADD COLUMN "reguaStep" TEXT;

-- A IDEMPOTÊNCIA DA RÉGUA MORA AQUI (03 §4.3: "idempotência em constraint").
--
-- A mesma etapa não dispara duas vezes na mesma cobrança, nem que o job rode
-- três vezes no mesmo dia. Sem esta trava, o cliente recebe a mesma mensagem
-- de cobrança repetida — que é o jeito mais rápido de a régua ser desligada
-- pela equipe no primeiro dia.
--
-- NULL não colide com NULL em índice único no Postgres, e aqui isso é o
-- comportamento desejado: contato MANUAL (reguaStep nulo) pode acontecer
-- quantas vezes for preciso.
CREATE UNIQUE INDEX "CollectionHistory_billingId_reguaStep_key"
  ON "CollectionHistory"("billingId", "reguaStep");

-- Bloqueio sem motivo é cliente que some da fila e ninguém percebe.
ALTER TABLE "Client" ADD CONSTRAINT "Client_bloqueio_com_motivo"
  CHECK ("collectionBlockReason" IS NULL OR length(trim("collectionBlockReason")) >= 5);
