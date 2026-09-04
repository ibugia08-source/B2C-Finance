import { prisma } from "@/lib/prisma";
import { runWithoutScope } from "@/lib/auth/owner-scope";

/**
 * LIMPEZA TOTAL DO SISTEMA — serviço de domínio.
 *
 * Zera os DADOS DE OPERAÇÃO preservando o que faz o sistema funcionar e a
 * configuração que o dono montou. É a mesma regra do scripts/inicio-limpo.ts
 * — e a lista mora AQUI, numa fonte única, exatamente porque uma lista
 * dessas divergindo entre script e botão seria o pior tipo de bug.
 *
 * A conferência roda NOS DOIS SENTIDOS: movimento zerado E estrutura com as
 * mesmas contagens de antes — só verificar que o movimento sumiu deixaria
 * passar o caso ruim: o CASCADE do banco levar junto uma tabela de estrutura.
 */

/** O que FICA. Apagar qualquer uma destas produz um sistema quebrado. */
export const ESTRUTURA = new Set([
  "_prisma_migrations",
  // Quem entra e o que cada um pode
  "User",
  "UserPermission",
  // Organização
  "Workspace",
  "LegalEntity",
  "Agency",
  "EconomicGroup",
  // Motor contábil e de métricas
  "AccountingAccount",
  "PostingRule",
  "MetricDefinition",
  "FeatureFlag",
  // Configuração que o dono montou e não quer remontar
  "Category",
  "CategorizationRule",
  "ContractTemplate",
  "AllocationRule",
  "ImportTemplate",
  "SavedView",
  "AISetting",
  "AnnualTarget",
]);

export type ResultadoLimpeza =
  | {
      ok: true;
      tabelasApagadas: number;
      registrosApagados: number;
      estrutura: { tabelas: number; registros: number };
    }
  | { ok: false; error: string; estruturaPerdida?: string[] };

export async function limparSistema(opts: {
  actorEmail: string | null;
}): Promise<ResultadoLimpeza> {
  return runWithoutScope(async () => {
    const tables: { tablename: string }[] = await prisma.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const nomes = tables.map((t) => t.tablename);
    const apagar = nomes.filter((t) => !ESTRUTURA.has(t));
    const manter = nomes.filter((t) => ESTRUTURA.has(t));

    const contar = async (t: string) => {
      const r: any = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      return Number(r[0]?.n ?? 0);
    };
    const antes: Record<string, number> = {};
    for (const t of nomes) antes[t] = await contar(t);
    const registrosApagados = apagar.reduce((s, t) => s + antes[t], 0);
    const registrosEstrutura = manter.reduce((s, t) => s + antes[t], 0);

    await prisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${apagar.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`
    );

    let sobrou = 0;
    for (const t of apagar) sobrou += await contar(t);
    const perdidas: string[] = [];
    for (const t of manter) {
      const agora = await contar(t);
      if (agora !== antes[t]) perdidas.push(`${t}: ${antes[t]} → ${agora}`);
    }
    if (perdidas.length > 0 || sobrou > 0) {
      return {
        ok: false,
        error:
          sobrou > 0
            ? `Sobraram ${sobrou} registro(s) de movimento — a limpeza não completou.`
            : "O banco levou junto tabela(s) de ESTRUTURA — restaure o backup mais recente antes de usar o sistema.",
        estruturaPerdida: perdidas,
      };
    }

    // Primeiro registro do sistema recém-limpo: QUEM limpou e quando. O
    // AuditLog acabou de ser zerado — este é o marco zero da nova história.
    const { auditEvent } = await import("@/lib/audit");
    await auditEvent(prisma, "Sistema", "workspace", "DELETE", {
      origin: "UI",
      reason: "Limpeza total pelo botão de Configurações — dados de operação zerados.",
      actorEmail: opts.actorEmail,
    });

    return {
      ok: true,
      tabelasApagadas: apagar.length,
      registrosApagados,
      estrutura: { tabelas: manter.length, registros: registrosEstrutura },
    };
  });
}
