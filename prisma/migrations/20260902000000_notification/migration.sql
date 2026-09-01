-- F1.19 — central de notificações in-app.
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "link" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'media',
    "day" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "digest" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMPTZ(3),
    "resolvedAt" TIMESTAMPTZ(3),
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- Agrupamento por origem, garantido pelo banco (02 §4.7).
CREATE UNIQUE INDEX "Notification_recipientId_event_day_key"
    ON "Notification"("recipientId", "event", "day");
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");
CREATE INDEX "Notification_day_idx" ON "Notification"("day");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_severidade_conhecida"
    CHECK ("severity" IN ('critica', 'alta', 'media'));

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey"
    FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- F1.12: RLS em toda tabela privada (mesmo padrão da 20260831190000).
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
