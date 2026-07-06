-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_personId_fkey";

-- DropForeignKey
ALTER TABLE "Contract" DROP CONSTRAINT "Contract_planId_fkey";

-- DropForeignKey
ALTER TABLE "Plan" DROP CONSTRAINT "Plan_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "PlanService" DROP CONSTRAINT "PlanService_ownerId_fkey";

-- DropForeignKey
ALTER TABLE "PlanService" DROP CONSTRAINT "PlanService_planId_fkey";

-- DropForeignKey
ALTER TABLE "PlanService" DROP CONSTRAINT "PlanService_serviceId_fkey";

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "personId";

-- AlterTable
ALTER TABLE "Contract" DROP COLUMN "planId";

-- DropTable
DROP TABLE "Plan";

-- DropTable
DROP TABLE "PlanService";

