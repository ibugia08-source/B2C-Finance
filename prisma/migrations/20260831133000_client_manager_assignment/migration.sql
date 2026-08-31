-- =====================================================================
-- F1.3 — ClientManagerAssignment: vigência de gestores (01 §4.3)
--
-- Mesma doença que o VALOR tinha antes da F1.2: no v1 o responsável era um
-- campo no Client, então trocar de gestor APAGAVA quem cuidava do cliente
-- no ano passado — e qualquer apuração de comissão ou de carteira por
-- gestor passava a mentir sobre o passado.
--
-- Backfill do que existe: Client.salesOwnerId (FK real para Employee) vira
-- COMMERCIAL_ORIGIN. Client.opsOwner é TEXTO LIVRE e hoje está vazio em
-- 100% da base — quando houver, entra por conciliação com o nome do
-- colaborador, nunca por adivinhação automática.
--
-- DROP INDEX de drift ("User_workspaceOwnerId_idx") removido do diff.
-- =====================================================================

-- CreateEnum
CREATE TYPE "ManagerRole" AS ENUM ('MANAGER_1', 'MANAGER_2', 'COMMERCIAL_ORIGIN', 'SDR_ORIGIN');


-- CreateTable
CREATE TABLE "ClientManagerAssignment" (
    "id" TEXT NOT NULL,
    "relationshipId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "role" "ManagerRole" NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "changedBy" TEXT,
    "reason" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClientManagerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientManagerAssignment_relationshipId_role_validFrom_idx" ON "ClientManagerAssignment"("relationshipId", "role", "validFrom");

-- CreateIndex
CREATE INDEX "ClientManagerAssignment_managerId_idx" ON "ClientManagerAssignment"("managerId");

-- CreateIndex
CREATE INDEX "ClientManagerAssignment_ownerId_idx" ON "ClientManagerAssignment"("ownerId");

-- AddForeignKey
ALTER TABLE "ClientManagerAssignment" ADD CONSTRAINT "ClientManagerAssignment_relationshipId_fkey" FOREIGN KEY ("relationshipId") REFERENCES "ClientAgencyRelationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientManagerAssignment" ADD CONSTRAINT "ClientManagerAssignment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientManagerAssignment" ADD CONSTRAINT "ClientManagerAssignment_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =====================================================================
-- BACKFILL: responsável comercial vigente, a partir do cadastro
--
-- validFrom = entrada da relação. validTo NULO = atribuição em vigor.
-- Idempotente pelo id derivado da relação + papel.
-- =====================================================================
INSERT INTO "ClientManagerAssignment" (
  "id", "relationshipId", "managerId", "role", "validFrom", "validTo",
  "reason", "ownerId", "createdAt", "updatedAt"
)
SELECT
  'asg_' || r."id" || '_co',
  r."id",
  c."salesOwnerId",
  'COMMERCIAL_ORIGIN'::"ManagerRole",
  COALESCE(r."startedAt", c."startedAt", c."createdAt"),
  NULL,
  'Migração do cadastro do v1 (F1.3)',
  r."ownerId",
  NOW(),
  NOW()
FROM "ClientAgencyRelationship" r
JOIN "Client" c ON c."id" = r."clientId"
WHERE c."salesOwnerId" IS NOT NULL
ON CONFLICT ("id") DO NOTHING;

-- opsOwner é texto livre: só vira atribuição quando casa EXATAMENTE com o
-- nome de um colaborador. Sem correspondência, nada é criado — inventar o
-- vínculo seria pior que deixar a lacuna visível.
INSERT INTO "ClientManagerAssignment" (
  "id", "relationshipId", "managerId", "role", "validFrom", "validTo",
  "reason", "ownerId", "createdAt", "updatedAt"
)
SELECT
  'asg_' || r."id" || '_m1',
  r."id",
  e."id",
  'MANAGER_1'::"ManagerRole",
  COALESCE(r."startedAt", c."startedAt", c."createdAt"),
  NULL,
  'Migração do cadastro do v1 (F1.3) — casado por nome',
  r."ownerId",
  NOW(),
  NOW()
FROM "ClientAgencyRelationship" r
JOIN "Client" c ON c."id" = r."clientId"
JOIN "Employee" e
  ON lower(btrim(e."name")) = lower(btrim(c."opsOwner"))
 AND e."ownerId" IS NOT DISTINCT FROM c."ownerId"
WHERE c."opsOwner" IS NOT NULL AND btrim(c."opsOwner") <> ''
ON CONFLICT ("id") DO NOTHING;

