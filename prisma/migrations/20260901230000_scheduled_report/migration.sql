-- F5.7 — envio agendado de relatório por e-mail.
CREATE TABLE "ScheduledReport" (
    "id" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "recipients" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMPTZ(3),
    "createdBy" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScheduledReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduledReport_enabled_idx" ON "ScheduledReport"("enabled");
CREATE INDEX "ScheduledReport_ownerId_idx" ON "ScheduledReport"("ownerId");

-- Frequência é vocabulário fechado: valor novo exige decisão, não typo.
ALTER TABLE "ScheduledReport" ADD CONSTRAINT "ScheduledReport_frequencia_conhecida"
    CHECK ("frequency" IN ('SEMANAL', 'MENSAL'));

ALTER TABLE "ScheduledReport" ADD CONSTRAINT "ScheduledReport_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- F1.12: RLS em toda tabela privada (mesmo padrão da 20260831190000).
ALTER TABLE "ScheduledReport" ENABLE ROW LEVEL SECURITY;
