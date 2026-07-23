-- Equipe/RBAC: workspace (membro enxerga dados do dono) + ajustes finos de
-- permissão por usuário. Aditiva e retrocompatível: usuários existentes ficam
-- com workspaceOwnerId NULL (continuam donos dos próprios dados).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "workspaceOwnerId" TEXT;

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permission_key" ON "UserPermission"("userId", "permission");

-- CreateIndex
CREATE INDEX "UserPermission_userId_idx" ON "UserPermission"("userId");

-- CreateIndex
CREATE INDEX "User_workspaceOwnerId_idx" ON "User"("workspaceOwnerId");

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_workspaceOwnerId_fkey" FOREIGN KEY ("workspaceOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
