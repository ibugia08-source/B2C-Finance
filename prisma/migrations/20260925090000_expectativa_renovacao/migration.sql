-- EXPECTATIVA DE RENOVAÇÃO COM DATA (25/09/2026).
--
-- Até aqui o cliente guardava só o MÊS de renovação (1-12, sem ano) e cada
-- tela contava renovação de um jeito. A regra do dono passa a ser:
--   data de entrada + prazo do contrato = data de expectativa de renovação.
-- Ela vira uma DATA (com ano) no cliente, e os desfechos (renovou / não
-- renovou) passam a guardar a qual competência de expectativa pertencem e o
-- valor que se esperava — é o que permite contar esperado, ganho e perdido
-- por mês, inclusive no histórico.

ALTER TABLE "Client" ADD COLUMN "expectedRenewalAt" TIMESTAMPTZ(3);
CREATE INDEX "Client_expectedRenewalAt_idx" ON "Client"("expectedRenewalAt");

ALTER TABLE "ClientRenewal" ADD COLUMN "expectedCompetence" TEXT;
ALTER TABLE "ClientRenewal" ADD COLUMN "expectedValue" DECIMAL(14,2);

ALTER TABLE "ClientLoss" ADD COLUMN "renewalCompetence" TEXT;
ALTER TABLE "ClientLoss" ADD COLUMN "expectedValue" DECIMAL(14,2);

-- ===== Backfill dos desfechos =====
-- Renovação antiga: pertence à competência de lançamento escolhida ou, sem
-- ela, ao mês em que foi registrada (fuso do workspace).
UPDATE "ClientRenewal"
SET "expectedCompetence" = CASE
  WHEN "billingYear" IS NOT NULL AND "billingMonth" IS NOT NULL
    THEN "billingYear"::text || '-' || lpad("billingMonth"::text, 2, '0')
  ELSE to_char("renewedAt" AT TIME ZONE 'America/Bahia', 'YYYY-MM')
END
WHERE "expectedCompetence" IS NULL;

-- Perda antiga só conta como renovação perdida quando aconteceu no mês de
-- renovação agendado do cliente (a regra que o painel antigo usava).
UPDATE "ClientLoss" l
SET "renewalCompetence" = to_char(l."lostAt" AT TIME ZONE 'America/Bahia', 'YYYY-MM'),
    "expectedValue" = CASE
      WHEN l."modality" = 'TCV' THEN COALESCE(l."referenceValue", l."monthlyValue")
      ELSE COALESCE(l."monthlyValue", l."referenceValue")
    END
FROM "Client" c
WHERE c."id" = l."clientId"
  AND c."renewalMonth" IS NOT NULL
  AND c."renewalMonth" = EXTRACT(MONTH FROM l."lostAt" AT TIME ZONE 'America/Bahia');

-- ===== Backfill da expectativa =====
-- Base e período, nesta ordem de autoridade:
--   1. última renovação registrada: novo fim de vigência, ciclo = meses dela;
--   2. entrada + prazo (a regra do dono), ciclo = prazo;
--   3. data de renovação do contrato vigente, ciclo = prazo ou 12;
--   4. mês de renovação legado (sem ano), ciclo = 12.
-- Datas que já passaram andam em ciclos até o mês corrente: o cliente segue
-- ativo, então aquelas renovações aconteceram (só não foram registradas).
WITH ultima_renovacao AS (
  SELECT DISTINCT ON ("clientId") "clientId", "newEndDate", "months"
  FROM "ClientRenewal"
  WHERE "newEndDate" IS NOT NULL
  ORDER BY "clientId", "renewedAt" DESC
),
contrato AS (
  SELECT DISTINCT ON ("clientId") "clientId", "renewalDate"
  FROM "Contract"
  WHERE "status" IN ('ACTIVE', 'RENEWAL') AND "renewalDate" IS NOT NULL
  ORDER BY "clientId", "renewalDate" DESC
),
base AS (
  -- d0 é o DIA CIVIL da primeira expectativa. Datas civis do sistema são
  -- lidas pelo dia em UTC (é assim que a tela as mostra): gravadas à
  -- meia-noite, 00:00 UTC no servidor e 03:00 UTC no fuso da Bahia.
  SELECT
    c."id",
    CASE
      WHEN r."newEndDate" IS NOT NULL THEN (r."newEndDate" AT TIME ZONE 'UTC')::date
      WHEN c."startedAt" IS NOT NULL AND c."contractMonths" IS NOT NULL AND c."contractMonths" > 0
        THEN ((c."startedAt" AT TIME ZONE 'UTC')::date + make_interval(months => c."contractMonths"))::date
      WHEN ct."renewalDate" IS NOT NULL THEN (ct."renewalDate" AT TIME ZONE 'UTC')::date
      WHEN c."renewalMonth" BETWEEN 1 AND 12 THEN
        make_date(EXTRACT(YEAR FROM now() AT TIME ZONE 'America/Bahia')::int, c."renewalMonth", 1)
    END AS d0,
    CASE
      WHEN r."newEndDate" IS NOT NULL THEN GREATEST(r."months", 1)
      WHEN c."contractMonths" IS NOT NULL AND c."contractMonths" > 0 THEN c."contractMonths"
      ELSE 12
    END AS p
  FROM "Client" c
  LEFT JOIN ultima_renovacao r ON r."clientId" = c."id"
  LEFT JOIN contrato ct ON ct."clientId" = c."id"
),
alvo AS (
  SELECT
    b."id", b.d0, b.p,
    (EXTRACT(YEAR FROM now() AT TIME ZONE 'America/Bahia') * 12
      + EXTRACT(MONTH FROM now() AT TIME ZONE 'America/Bahia'))
    - (EXTRACT(YEAR FROM b.d0) * 12 + EXTRACT(MONTH FROM b.d0)) AS atraso
  FROM base b
  WHERE b.d0 IS NOT NULL
)
-- Grava ao MEIO-DIA da Bahia do dia civil: as leituras em UTC e na Bahia
-- concordam, e nenhuma borda de mês a desloca.
UPDATE "Client" c
SET "expectedRenewalAt" = (
  (CASE
    WHEN a.atraso <= 0 THEN a.d0
    ELSE (a.d0 + make_interval(months => (CEIL(a.atraso::numeric / a.p) * a.p)::int))::date
  END + time '12:00') AT TIME ZONE 'America/Bahia'
)
FROM alvo a
WHERE a."id" = c."id";
