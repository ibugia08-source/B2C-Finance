-- Inadimplência manual por competência (histórico mês a mês)
CREATE TABLE IF NOT EXISTS "ClientMonthDelinquency" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "DelinquencyStatus" NOT NULL,
    "setBy" TEXT,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ownerId" TEXT,

    CONSTRAINT "ClientMonthDelinquency_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ClientMonthDelinquency_year_month_idx"
    ON "ClientMonthDelinquency"("year", "month");
CREATE INDEX IF NOT EXISTS "ClientMonthDelinquency_clientId_year_month_idx"
    ON "ClientMonthDelinquency"("clientId", "year", "month");
CREATE INDEX IF NOT EXISTS "ClientMonthDelinquency_ownerId_idx"
    ON "ClientMonthDelinquency"("ownerId");

ALTER TABLE "ClientMonthDelinquency"
    ADD CONSTRAINT "ClientMonthDelinquency_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "Client"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientMonthDelinquency"
    ADD CONSTRAINT "ClientMonthDelinquency_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: migra o override legado (campo único no Client) para o histórico
INSERT INTO "ClientMonthDelinquency" ("id", "clientId", "month", "year", "status", "setBy", "setAt", "ownerId")
SELECT
    gen_random_uuid()::text,
    c."id",
    c."delinquencyOverrideMonth",
    c."delinquencyOverrideYear",
    c."delinquencyOverride",
    c."delinquencyOverrideBy",
    COALESCE(c."delinquencyOverrideAt", CURRENT_TIMESTAMP),
    c."ownerId"
FROM "Client" c
WHERE c."delinquencyOverride" IS NOT NULL
  AND c."delinquencyOverrideMonth" IS NOT NULL
  AND c."delinquencyOverrideYear" IS NOT NULL;
