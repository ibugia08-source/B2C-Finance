-- DropForeignKey
ALTER TABLE "CostCenter" DROP CONSTRAINT "CostCenter_clientId_fkey";

-- DropForeignKey
ALTER TABLE "CostCenter" DROP CONSTRAINT "CostCenter_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "CostCenter" DROP CONSTRAINT "CostCenter_serviceId_fkey";

-- DropForeignKey
ALTER TABLE "Income" DROP CONSTRAINT "Income_costCenterId_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_costCenterId_fkey";

-- DropIndex
DROP INDEX "Income_costCenterId_idx";

-- DropIndex
DROP INDEX "Transaction_costCenterId_idx";

-- AlterTable
ALTER TABLE "Income" DROP COLUMN "costCenterId";

-- AlterTable
ALTER TABLE "Transaction" DROP COLUMN "costCenterId";

-- DropTable
DROP TABLE "CostCenter";

-- DropEnum
DROP TYPE "CostCenterType";

