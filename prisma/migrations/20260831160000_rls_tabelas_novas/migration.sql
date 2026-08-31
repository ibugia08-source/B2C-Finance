-- =====================================================================
-- F1.12 — RLS nas tabelas novas (ref. 03 §1.4)
--
-- CONTEXTO, para quem ler isto sem o histórico: aqui o RLS não protege o
-- app contra ele mesmo. O Prisma conecta como DONA das tabelas, e dona
-- não é afetada por RLS. O que estas linhas bloqueiam é a API pública
-- PostgREST do Supabase (roles `anon` e `authenticated`): com RLS ligado
-- e ZERO policies, essas roles não leem NADA. O isolamento entre usuários
-- do produto é feito na aplicação, pela extensão de ownerId do Prisma.
--
-- O PROBLEMA QUE ISTO CORRIGE: a migration original (20260724000000)
-- ligou RLS em todas as tabelas QUE EXISTIAM NAQUELE DIA. Toda tabela
-- criada depois nasceu SEM — e eram 23, incluindo o razão contábil, a
-- trilha de auditoria, os créditos de cliente e a relação cliente↔agência.
-- Ou seja: exatamente as tabelas mais sensíveis do sistema.
--
-- Este arquivo é idempotente e pode ser reexecutado. Mas repetir a
-- migration a cada fase seria contar com a memória de alguém — por isso a
-- suíte ganhou um teste que REPROVA quando existe tabela sem RLS. O teste
-- é a garantia; esta migration é só o conserto de agora.
-- =====================================================================

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname NOT LIKE '\_prisma%'
       AND c.relrowsecurity = FALSE
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    RAISE NOTICE 'RLS ligado em %', r.relname;
  END LOOP;
END $$;

-- Cinto e suspensório: mesmo que alguém desligue o RLS de uma tabela no
-- futuro, a API pública continua sem privilégio. Os REVOKE são
-- idempotentes; os DO blocks toleram a ausência das roles (o Postgres
-- local não tem `anon`/`authenticated`, o Supabase tem).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END $$;
