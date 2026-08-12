-- (drift pré-existente de índice em User ignorado de propósito — esta
--  migration é puramente ADITIVA: só cria AnnualTarget)

-- CreateTable
CREATE TABLE "AnnualTarget" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "revenueTarget" DECIMAL(14,2) NOT NULL,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnualTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AnnualTarget_ownerId_idx" ON "AnnualTarget"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnualTarget_ownerId_year_key" ON "AnnualTarget"("ownerId", "year");

-- AddForeignKey
ALTER TABLE "AnnualTarget" ADD CONSTRAINT "AnnualTarget_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
