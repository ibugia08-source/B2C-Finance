-- DropForeignKey
ALTER TABLE "Commission" DROP CONSTRAINT "Commission_clientId_fkey";

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CollectionHistory" ADD COLUMN     "actionType" TEXT,
ADD COLUMN     "createdBy" TEXT;

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
