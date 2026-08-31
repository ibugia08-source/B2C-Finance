-- F1.10 · Recorte de dados por usuário (03 §1.1).
--
-- DECIDIDO 19.11 em 31/08: existem DOIS recortes, não cinco. "meus clientes"
-- saiu porque exigiria ligar o usuário do login à pessoa da folha, e a direção
-- decidiu que esse vínculo não existe. A AGÊNCIA passa a ser o recorte, que é
-- para o que ela serve (19.15).
--
-- Todo usuário nasce em WORKSPACE (o comportamento de hoje). Estreitar é uma
-- escolha explícita do dono no painel — nunca um efeito colateral de migration.
--
-- O DROP INDEX "User_workspaceOwnerId_idx" que o prisma migrate diff propõe
-- FOI REMOVIDO de propósito: esse índice nasceu de SQL cru na migration
-- 20260723210000 e é invisível para o schema.prisma, então toda diff acha que
-- ele sobra. Ele não sobra.

ALTER TABLE "User" ADD COLUMN "dataScope" TEXT NOT NULL DEFAULT 'WORKSPACE';
ALTER TABLE "User" ADD COLUMN "scopeAgencyId" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_scopeAgencyId_fkey"
  FOREIGN KEY ("scopeAgencyId") REFERENCES "Agency"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "User_scopeAgencyId_idx" ON "User"("scopeAgencyId");

-- Guarda de coerência: scopeAgencyId só faz sentido com dataScope = 'AGENCY',
-- e AGENCY sem agência seria um usuário que não enxerga nada por acidente.
ALTER TABLE "User" ADD CONSTRAINT "User_dataScope_coerente"
  CHECK (
    ("dataScope" = 'WORKSPACE' AND "scopeAgencyId" IS NULL)
    OR ("dataScope" = 'AGENCY' AND "scopeAgencyId" IS NOT NULL)
  );
