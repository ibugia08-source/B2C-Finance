-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "defaultDuration" INTEGER,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "recurrence" "RecurrenceType" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "type" "ContractType" NOT NULL DEFAULT 'MRR';

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "category" TEXT,
ADD COLUMN     "defaultOwner" TEXT,
ADD COLUMN     "estimatedCost" DECIMAL(14,2),
ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "PlanService" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanService_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanService_planId_idx" ON "PlanService"("planId");

-- CreateIndex
CREATE INDEX "PlanService_serviceId_idx" ON "PlanService"("serviceId");

-- CreateIndex
CREATE INDEX "PlanService_ownerId_idx" ON "PlanService"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanService_planId_serviceId_key" ON "PlanService"("planId", "serviceId");

-- CreateIndex
CREATE INDEX "Service_category_idx" ON "Service"("category");

-- AddForeignKey
ALTER TABLE "PlanService" ADD CONSTRAINT "PlanService_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanService" ADD CONSTRAINT "PlanService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanService" ADD CONSTRAINT "PlanService_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

