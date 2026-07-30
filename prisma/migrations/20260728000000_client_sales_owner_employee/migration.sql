-- Vínculo real do responsável comercial: Client.salesOwnerId -> Employee.
-- O campo texto Client."salesOwner" é mantido como denormalização (sincronizado
-- no save e pelo script scripts/backfill-sales-owner.ts).
ALTER TABLE "Client" ADD COLUMN "salesOwnerId" TEXT;

ALTER TABLE "Client" ADD CONSTRAINT "Client_salesOwnerId_fkey"
  FOREIGN KEY ("salesOwnerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Client_salesOwnerId_idx" ON "Client"("salesOwnerId");
