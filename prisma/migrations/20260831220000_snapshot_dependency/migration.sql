-- F2.6 · Rastro de reconferência (01 §5.5).
--
-- Marcar setembro como "reconferir" sem dizer por quê transforma o aviso em
-- ruído: em três meses ninguém lembra qual reabertura o causou, e o time
-- aprende a ignorar a marca. Cada linha responde "quem mexeu no meu passado,
-- quando, e com que justificativa".
--
-- NÃO é fila de aprovação: a direção decidiu em 31/08 (19.35/19.36) que fila
-- de aprovação não existe no sistema. Isto é rastro.
--
-- DROP INDEX de drift removido (ver 20260723210000).

CREATE TABLE "SnapshotDependency" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "dependsOnCompetence" TEXT NOT NULL,
    "originVersion" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "markedBy" TEXT,
    "markedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clearedBy" TEXT,
    "clearedAt" TIMESTAMPTZ(3),
    "clearNote" TEXT,

    CONSTRAINT "SnapshotDependency_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SnapshotDependency_snapshotId_idx" ON "SnapshotDependency"("snapshotId");
CREATE INDEX "SnapshotDependency_dependsOnCompetence_idx" ON "SnapshotDependency"("dependsOnCompetence");

ALTER TABLE "SnapshotDependency" ADD CONSTRAINT "SnapshotDependency_snapshotId_fkey"
  FOREIGN KEY ("snapshotId") REFERENCES "Snapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reabrir sem motivo não existe (§5.5), e o rastro não pode nascer vazio.
ALTER TABLE "SnapshotDependency" ADD CONSTRAINT "SnapshotDependency_motivo_obrigatorio"
  CHECK (length(btrim("reason")) >= 10);

ALTER TABLE "SnapshotDependency" ENABLE ROW LEVEL SECURITY;
