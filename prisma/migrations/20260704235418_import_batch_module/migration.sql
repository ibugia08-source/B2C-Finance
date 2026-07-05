-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "errors" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "module" TEXT;

