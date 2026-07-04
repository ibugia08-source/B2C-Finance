-- Assistente por usuário: histórico (AIConversation) e memória (AIMemory)
-- passam a ser privados por dono (ownerId). AISetting/AIMessage seguem globais.

-- AlterTable
ALTER TABLE "AIConversation" ADD COLUMN     "ownerId" TEXT;

-- AlterTable
ALTER TABLE "AIMemory" ADD COLUMN     "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "AIConversation_ownerId_idx" ON "AIConversation"("ownerId");

-- CreateIndex
CREATE INDEX "AIMemory_ownerId_idx" ON "AIMemory"("ownerId");

-- AddForeignKey
ALTER TABLE "AIConversation" ADD CONSTRAINT "AIConversation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIMemory" ADD CONSTRAINT "AIMemory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: conversas e memórias já existentes (que eram globais) passam a
-- pertencer ao admin primário, para o admin não perder o próprio histórico.
UPDATE "AIConversation"
   SET "ownerId" = (
     SELECT "id" FROM "User"
      WHERE "role" = 'ADMIN' AND "active" = true
      ORDER BY "createdAt" ASC
      LIMIT 1
   )
 WHERE "ownerId" IS NULL;

UPDATE "AIMemory"
   SET "ownerId" = (
     SELECT "id" FROM "User"
      WHERE "role" = 'ADMIN' AND "active" = true
      ORDER BY "createdAt" ASC
      LIMIT 1
   )
 WHERE "ownerId" IS NULL;
