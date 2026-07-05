-- CreateEnum
CREATE TYPE "ViewVisibility" AS ENUM ('PRIVATE', 'GLOBAL');

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "visibility" "ViewVisibility" NOT NULL DEFAULT 'PRIVATE',
    "createdBy" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedView_ownerId_module_idx" ON "SavedView"("ownerId", "module");

-- CreateIndex
CREATE INDEX "SavedView_createdBy_idx" ON "SavedView"("createdBy");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

