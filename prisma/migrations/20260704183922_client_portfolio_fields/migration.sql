-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "city" TEXT,
ADD COLUMN     "opsOwner" TEXT,
ADD COLUMN     "origin" TEXT,
ADD COLUMN     "paymentDay" INTEGER,
ADD COLUMN     "salesOwner" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

