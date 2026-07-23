-- Segurança em profundidade no banco (Supabase):
--
-- 1. RLS em TODAS as tabelas do schema public. O app acessa o banco via
--    Prisma com a role `postgres` (DONA das tabelas → RLS não a afeta).
--    O que o RLS bloqueia é a API PostgREST do Supabase (roles `anon` e
--    `authenticated`): sem policies, essas roles não leem NADA — as tabelas
--    deixam de aparecer como "Unrestricted" no painel.
--
-- 2. REVOKE dos privilégios das roles `anon` e `authenticated` — cinto e
--    suspensório: mesmo que alguém desabilite o RLS de uma tabela no futuro,
--    a API pública continua sem privilégio de acesso.
--
-- 3. Colunas de proteção contra força bruta no login (contador de falhas +
--    bloqueio temporário), usadas por lib/actions/auth.ts.

-- ===== 1. RLS em todas as tabelas existentes =====
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- ===== 2. API pública do Supabase sem acesso ao schema public =====
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- ===== 3. Throttle de login =====
ALTER TABLE "User" ADD COLUMN "failedLogins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
