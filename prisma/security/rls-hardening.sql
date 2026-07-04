-- ============================================================================
-- B2C Finance — Blindagem de segurança do banco (Supabase / PostgreSQL)
-- ----------------------------------------------------------------------------
-- COMO USAR: abra o Supabase → SQL Editor → New query → cole TUDO → Run.
--
-- POR QUE É SEGURO PARA O APP:
--   O app acessa o banco via Prisma, conectando como o papel "postgres" (DONO
--   das tabelas). O dono IGNORA RLS (não usamos FORCE), então todas as queries
--   do app continuam funcionando. Este script só bloqueia a API REST pública
--   do Supabase (papéis "anon" e "authenticated"), que é a real brecha:
--   sem RLS, qualquer um com a chave anon (pública) lê/escreve no banco.
--
-- IDEMPOTENTE: pode rodar novamente sem problemas.
-- ============================================================================

-- 1) Liga Row Level Security em TODAS as tabelas do schema public.
--    Sem políticas para anon/authenticated => acesso negado por padrão.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', r.tablename);
  end loop;
end $$;

-- 2) Revoga TODO acesso dos papéis da API pública (anon/authenticated)
--    em tabelas, sequences e funções já existentes.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('revoke all on public.%I from anon, authenticated;', r.tablename);
  end loop;
end $$;

revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- 3) Tira o acesso ao próprio schema public da API pública.
--    (O app NÃO usa a API REST do Supabase — usa Prisma como "postgres".)
revoke usage on schema public from anon, authenticated;

-- 4) Impede que tabelas/sequences/funções FUTURAS voltem a ser expostas
--    (default privileges para objetos criados pelo papel postgres).
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

-- ============================================================================
-- VERIFICAÇÃO — rode separadamente para conferir o resultado:
--
--   -- Deve listar TODAS as tabelas com rowsecurity = true:
--   select tablename, rowsecurity
--   from pg_tables where schemaname = 'public' order by tablename;
--
--   -- Não deve retornar nenhuma linha (nenhum grant para anon/authenticated):
--   select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and grantee in ('anon','authenticated');
-- ============================================================================
