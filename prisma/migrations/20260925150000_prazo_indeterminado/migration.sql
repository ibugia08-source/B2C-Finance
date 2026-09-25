-- Prazo INDETERMINADO (decisão do dono, 25/09/2026): cliente sem data de
-- término, ativo até ser dado como perdido/inativo. Sem prazo em meses e sem
-- expectativa de renovação automática — só a agendada à mão.
ALTER TABLE "Client" ADD COLUMN "contractIndefinite" BOOLEAN NOT NULL DEFAULT false;

-- Renovação registrada com prazo indeterminado não tem "meses do ciclo".
ALTER TABLE "ClientRenewal" ALTER COLUMN "months" DROP NOT NULL;
