-- F2.1 · ClosingPeriod (01 §5.2, §5.5; 03 §4.4).
--
-- UMA linha por competência e escopo, com o estado CORRENTE e a versão. O
-- histórico de cada fechamento não mora aqui: mora na fotografia (F2.3) e na
-- trilha de auditoria. "Agosto v1 preservado, agosto v2 novo" de §5.5 é sobre
-- a FOTOGRAFIA — o período tem um estado só, o de agora.
--
-- Nenhuma linha é criada por esta migration, de propósito: competência sem
-- linha é ABERTA. Semear 12 meses de OPEN só criaria a ilusão de que alguém
-- decidiu alguma coisa sobre eles.
--
-- DROP INDEX de drift removido (ver 20260723210000).

CREATE TYPE "PeriodState" AS ENUM ('OPEN', 'SOFT_CLOSED', 'CLOSED', 'REOPENED');

CREATE TABLE "ClosingPeriod" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'WORKSPACE',
    "scopeId" TEXT NOT NULL DEFAULT '',
    "competence" TEXT NOT NULL,
    "state" "PeriodState" NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "needsRevalidation" BOOLEAN NOT NULL DEFAULT false,
    "softClosedAt" TIMESTAMPTZ(3),
    "softClosedBy" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "closedBy" TEXT,
    "reopenedAt" TIMESTAMPTZ(3),
    "reopenedBy" TEXT,
    "reopenReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClosingPeriod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClosingPeriod_workspaceId_competence_idx" ON "ClosingPeriod"("workspaceId", "competence");
CREATE INDEX "ClosingPeriod_state_idx" ON "ClosingPeriod"("state");
CREATE UNIQUE INDEX "ClosingPeriod_workspaceId_scopeType_scopeId_competence_key"
  ON "ClosingPeriod"("workspaceId", "scopeType", "scopeId", "competence");

ALTER TABLE "ClosingPeriod" ADD CONSTRAINT "ClosingPeriod_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- scopeId é '' e não NULL de propósito: no Postgres NULL nunca é igual a NULL,
-- então coluna nula dentro de índice único NÃO impede duplicata. Com nulo,
-- dois fechamentos do mesmo mês conviveriam sem o banco reclamar — e o
-- fechamento é justamente onde duplicata silenciosa faz estrago.

-- A competência é YYYY-MM em todo o sistema (F0.4). Formato solto aqui abriria
-- a porta para "2026-9" e "09/2026" conviverem, e a comparação de texto que
-- ordena os meses passaria a mentir.
ALTER TABLE "ClosingPeriod" ADD CONSTRAINT "ClosingPeriod_competence_formato"
  CHECK ("competence" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Reabrir sem justificativa não existe (§5.5). A regra é do banco, não só da
-- tela: reabertura também acontece por script e por job.
ALTER TABLE "ClosingPeriod" ADD CONSTRAINT "ClosingPeriod_reabertura_justificada"
  CHECK ("state" <> 'REOPENED' OR ("reopenReason" IS NOT NULL AND length(btrim("reopenReason")) >= 10));

-- Fechado é fechado por alguém, em algum instante.
ALTER TABLE "ClosingPeriod" ADD CONSTRAINT "ClosingPeriod_fechamento_datado"
  CHECK ("state" <> 'CLOSED' OR "closedAt" IS NOT NULL);

-- SEM FORCE (mesmo motivo da 20260831160000: o Prisma conecta como dona).
ALTER TABLE "ClosingPeriod" ENABLE ROW LEVEL SECURITY;
