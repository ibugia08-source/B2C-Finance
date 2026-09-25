-- TAGS EM MINÚSCULAS (auditoria 25/09/2026). A busca da carteira procura a
-- tag em minúsculas; tags gravadas com maiúsculas ("VIP") nunca eram
-- encontradas. O cadastro agora normaliza ao salvar; aqui, as existentes.
UPDATE "Client"
SET "tags" = ARRAY(
  SELECT DISTINCT lower(btrim(t)) FROM unnest("tags") AS t WHERE btrim(t) <> ''
)
WHERE EXISTS (SELECT 1 FROM unnest("tags") AS t WHERE t <> lower(btrim(t)) OR btrim(t) = '');
