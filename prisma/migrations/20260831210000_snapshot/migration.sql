-- F2.3 · Fotografia do período (01 §5.4, §5.7).
--
-- Guarda o mês inteiro por ÁREA com metadados suficientes para responder,
-- meses depois, "com que régua este número foi medido?".
--
-- checksum POR ÁREA além do total, de propósito: quando a conferência
-- periódica acusa divergência, "algo mudou no mês" é inútil; "a carteira
-- mudou e o resto não" aponta para onde olhar.
--
-- `name` é '' e não NULL pelo mesmo motivo de scopeId em ClosingPeriod: NULL
-- nunca é igual a NULL no Postgres, e com nulo duas fotografias nativas do
-- mesmo fechamento conviveriam sem o índice único reclamar.
--
-- DROP INDEX de drift removido (ver 20260723210000).

CREATE TYPE "SnapshotKind" AS ENUM ('NATIVE', 'STANDALONE', 'REBUILT_FROM_MIGRATION');

CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'WORKSPACE',
    "scopeId" TEXT NOT NULL DEFAULT '',
    "competence" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "kind" "SnapshotKind" NOT NULL DEFAULT 'NATIVE',
    "name" TEXT NOT NULL DEFAULT '',
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "metricRegistryVersion" INTEGER NOT NULL,
    "sourceCutoffAt" TIMESTAMPTZ(3) NOT NULL,
    "systemVersion" TEXT,
    "closedBy" TEXT,
    "closedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "areas" JSONB NOT NULL,
    "layoutDefinition" JSONB,
    "checksum" TEXT NOT NULL,
    "checksumByArea" JSONB NOT NULL,
    "needsRevalidation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Snapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Snapshot_workspaceId_competence_idx" ON "Snapshot"("workspaceId", "competence");
CREATE INDEX "Snapshot_kind_idx" ON "Snapshot"("kind");
CREATE UNIQUE INDEX "Snapshot_workspaceId_scopeType_scopeId_competence_version_k_key"
  ON "Snapshot"("workspaceId", "scopeType", "scopeId", "competence", "version", "kind", "name");

ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_competence_formato"
  CHECK ("competence" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- Fotografia é FATO CONSUMADO: reescrever uma apagaria a prova de como o mês
-- fechou, que é a única coisa que ela existe para guardar. Alterar é proibido;
-- corrigir é fechar de novo, gerando a versão seguinte (§5.5).
CREATE OR REPLACE FUNCTION b2c_snapshot_imutavel() RETURNS trigger AS $$
BEGIN
  -- needsRevalidation é a ÚNICA coluna que muda depois: ela não altera o
  -- conteúdo da fotografia, marca que o passado dela mudou.
  IF TG_OP = 'UPDATE' THEN
    IF NEW."checksum" IS DISTINCT FROM OLD."checksum"
       OR NEW."areas"::text IS DISTINCT FROM OLD."areas"::text
       OR NEW."competence" IS DISTINCT FROM OLD."competence"
       OR NEW."version" IS DISTINCT FROM OLD."version" THEN
      RAISE EXCEPTION 'Fotografia é imutável: para corrigir, reabra a competência e feche de novo.';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Fotografia não pode ser apagada.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER b2c_snapshot_imutavel
  BEFORE UPDATE OR DELETE ON "Snapshot"
  FOR EACH ROW EXECUTE FUNCTION b2c_snapshot_imutavel();

ALTER TABLE "Snapshot" ENABLE ROW LEVEL SECURITY;
