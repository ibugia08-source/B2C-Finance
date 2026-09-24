-- Nichos como CATÁLOGO da plataforma (24/09/2026).
--
-- O nicho do cliente era texto livre (Client.segment) e virou "Imobiliária"
-- e "IMOBILIÁRIA" convivendo na carteira. Agora existe a tabela Niche,
-- cadastrada uma vez pelo ADMIN, e o cliente aponta para ela (nicheId).
-- `segment` continua existindo como o NOME denormalizado (espelho de
-- niche.name), porque relatórios, retenção, busca e documentos leem o texto.
--
-- Backfill: cada valor distinto de segment (normalizado: sem espaços nas
-- pontas, espaços internos colapsados, minúsculas) vira UM nicho por dono;
-- o nome exibido é a grafia mais frequente entre os clientes; todo cliente
-- passa a apontar para o nicho e ganha o nome padronizado em segment.

CREATE TABLE "Niche" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "ownerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Niche_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Niche_ownerId_slug_key" ON "Niche"("ownerId", "slug");
CREATE INDEX "Niche_ownerId_idx" ON "Niche"("ownerId");

ALTER TABLE "Niche" ADD CONSTRAINT "Niche_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Client" ADD COLUMN "nicheId" TEXT;

ALTER TABLE "Client" ADD CONSTRAINT "Client_nicheId_fkey"
  FOREIGN KEY ("nicheId") REFERENCES "Niche"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===== Backfill =====
-- 1) Um nicho por (dono, slug); o nome exibido é a grafia mais usada.
WITH normalizado AS (
  SELECT
    "ownerId",
    regexp_replace(btrim("segment"), '\s+', ' ', 'g') AS nome,
    lower(regexp_replace(btrim("segment"), '\s+', ' ', 'g')) AS slug
  FROM "Client"
  WHERE "segment" IS NOT NULL AND btrim("segment") <> ''
),
contado AS (
  SELECT "ownerId", slug, nome, count(*) AS usos
  FROM normalizado
  GROUP BY "ownerId", slug, nome
),
escolhido AS (
  SELECT DISTINCT ON ("ownerId", slug) "ownerId", slug, nome
  FROM contado
  ORDER BY "ownerId", slug, usos DESC, nome ASC
)
INSERT INTO "Niche" ("id", "name", "slug", "ownerId", "createdAt", "updatedAt")
SELECT
  'nch_' || substr(md5(coalesce("ownerId", '') || '|' || slug), 1, 24),
  nome, slug, "ownerId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM escolhido;

-- 2) Cliente aponta para o nicho e recebe o nome padronizado.
UPDATE "Client" c
SET "nicheId" = n."id", "segment" = n."name"
FROM "Niche" n
WHERE c."segment" IS NOT NULL AND btrim(c."segment") <> ''
  AND n."slug" = lower(regexp_replace(btrim(c."segment"), '\s+', ' ', 'g'))
  AND n."ownerId" IS NOT DISTINCT FROM c."ownerId";

-- 3) Segmento em branco vira NULL (= "Sem nicho").
UPDATE "Client" SET "segment" = NULL WHERE "segment" IS NOT NULL AND btrim("segment") = '';

-- F1.12: toda tabela nasce com RLS ligado (sem policy = ninguém além do dono
-- da conexão lê; a app acessa como dono da tabela).
ALTER TABLE "Niche" ENABLE ROW LEVEL SECURITY;
