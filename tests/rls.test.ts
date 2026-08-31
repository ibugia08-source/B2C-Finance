import { describe, expect, it } from "vitest";
import { prisma, runWithoutScope } from "./support/db";

/**
 * F1.12 — isolamento no banco (03 §1.4).
 *
 * O QUE ESTE TESTE GUARDA, e o que ele NÃO guarda:
 *
 * Aqui o RLS não protege o app contra ele mesmo — o Prisma conecta como
 * DONA das tabelas, e dona não é afetada por RLS. O que ele bloqueia é a
 * API pública PostgREST do Supabase: com RLS ligado e ZERO policies, as
 * roles `anon` e `authenticated` não leem nada. O isolamento ENTRE
 * usuários do produto é feito na aplicação, pela extensão de ownerId, e
 * está coberto pelos testes de escopo dos outros arquivos.
 *
 * A falha real que este teste existe para impedir é de OMISSÃO: a
 * migration original ligou RLS nas tabelas que existiam naquele dia, e
 * toda tabela criada depois nasceu sem. Quando isto foi conferido, eram
 * 23 tabelas descobertas — incluindo o razão contábil, a trilha de
 * auditoria e os créditos de cliente.
 *
 * Por isso o teste é sobre TODAS as tabelas, e não sobre uma lista: lista
 * escrita à mão é a mesma memória que falhou da primeira vez.
 */
describe("F1.12 — RLS", () => {
  it("TODA tabela do schema tem RLS ligado", async () => {
    const linhas = await runWithoutScope(async () =>
      prisma.$queryRawUnsafe<{ tabela: string }[]>(`
        SELECT c.relname AS tabela
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relname NOT LIKE '\\_prisma%'
           AND c.relrowsecurity = FALSE
         ORDER BY c.relname
      `)
    );
    const semRls = linhas.map((l) => l.tabela);
    // A mensagem nomeia as culpadas: quem criar uma tabela nova e vir este
    // teste falhar já sabe o que fazer sem precisar investigar.
    expect(semRls, `tabelas sem RLS: ${semRls.join(", ")}`).toEqual([]);
  });

  it("nenhuma policy permissiva foi criada por engano", async () => {
    // Zero policies é PROPOSITAL: com RLS ligado e nenhuma policy, as roles
    // públicas não leem nada. Uma policy aparecendo aqui significa que
    // alguém abriu uma porta — e precisa ser uma decisão consciente.
    const policies = await runWithoutScope(async () =>
      prisma.$queryRawUnsafe<{ tablename: string; policyname: string }[]>(
        `SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'`
      )
    );
    expect(policies.map((p) => `${p.tablename}.${p.policyname}`)).toEqual([]);
  });
});
