/**
 * SEED DO PLANO DE CONTAS (F0.6 — ref. 03 §2.2).
 *
 * Idempotente: pode rodar quantas vezes for preciso. Cria/atualiza as contas
 * a partir de prisma/chart-of-accounts.ts, monta a hierarquia pelo código e
 * liga cada Category do v1 à conta correspondente (de-para explícito; o que
 * não casa fica SEM conta e aparece no relatório, nunca é adivinhado).
 *
 * Uso:
 *   APP_ENV=local ALLOW_DESTRUCTIVE=true npx tsx prisma/seed-chart-of-accounts.ts
 */
import { loadEnv } from "../scripts/env";
import { assertDestructiveAllowed } from "../scripts/guard";
import {
  CHART_OF_ACCOUNTS,
  CATEGORY_TO_ACCOUNT,
  GROUP_LABELS,
  normalBalanceOf,
  statementTypeOf,
  rootCode,
} from "./chart-of-accounts";

loadEnv();

async function main() {
  assertDestructiveAllowed({ script: "prisma/seed-chart-of-accounts.ts" });

  const { prisma } = await import("@/lib/prisma");
  const { runWithoutScope } = await import("@/lib/auth/owner-scope");

  await runWithoutScope(async () => {
    const workspace = await prisma.workspace.findFirst({ select: { id: true, name: true } });
    if (!workspace) throw new Error("Nenhum Workspace encontrado — rode as migrations antes.");
    console.log(`→ workspace: ${workspace.name}`);

    // ===== 1) Contas (sem pai ainda) =====
    let criadas = 0;
    let atualizadas = 0;
    for (const c of CHART_OF_ACCOUNTS) {
      const dados = {
        name: c.name,
        group: GROUP_LABELS[rootCode(c.code)] ?? rootCode(c.code),
        accountType: c.accountType as any,
        normalBalance: normalBalanceOf(c.accountType) as any,
        statementType: statementTypeOf(c.accountType) as any,
        isPostingAccount: c.posting !== false,
        isUnclassified: c.unclassified === true,
        active: true,
      };
      const existente = await prisma.accountingAccount.findFirst({
        where: { workspaceId: workspace.id, code: c.code },
        select: { id: true },
      });
      if (existente) {
        await prisma.accountingAccount.update({ where: { id: existente.id }, data: dados });
        atualizadas++;
      } else {
        await prisma.accountingAccount.create({
          data: { ...dados, workspaceId: workspace.id, code: c.code },
        });
        criadas++;
      }
    }
    console.log(`→ contas: ${criadas} criada(s), ${atualizadas} atualizada(s)`);

    // ===== 2) Hierarquia pelo código ("4.1" tem pai "4") =====
    const todas = await prisma.accountingAccount.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, code: true, parentId: true },
    });
    const porCodigo = new Map(todas.map((a) => [a.code, a]));
    let vinculos = 0;
    for (const a of todas) {
      const pai = a.code.includes(".") ? porCodigo.get(a.code.slice(0, a.code.lastIndexOf("."))) : null;
      const alvo = pai?.id ?? null;
      if (a.parentId !== alvo) {
        await prisma.accountingAccount.update({ where: { id: a.id }, data: { parentId: alvo } });
        vinculos++;
      }
    }
    console.log(`→ hierarquia: ${vinculos} vínculo(s) ajustado(s)`);

    // ===== 3) De-para das categorias do v1 =====
    const categorias = await prisma.category.findMany({ select: { id: true, name: true, accountId: true } });
    let ligadas = 0;
    const semConta: string[] = [];
    for (const cat of categorias) {
      const codigo = CATEGORY_TO_ACCOUNT[cat.name];
      if (!codigo) {
        if (!cat.accountId) semConta.push(cat.name);
        continue;
      }
      const conta = porCodigo.get(codigo);
      if (!conta) {
        semConta.push(`${cat.name} (código ${codigo} inexistente)`);
        continue;
      }
      if (cat.accountId !== conta.id) {
        await prisma.category.update({ where: { id: cat.id }, data: { accountId: conta.id } });
        ligadas++;
      }
    }
    console.log(`→ categorias ligadas a contas: ${ligadas}`);
    if (semConta.length > 0) {
      console.log(`→ ATENÇÃO: ${semConta.length} categoria(s) sem conta — classificar manualmente:`);
      for (const nome of semConta) console.log(`   · ${nome}`);
    }

    // ===== 4) Conferência da natureza (03 §2.2) =====
    const naDre = await prisma.accountingAccount.count({
      where: { workspaceId: workspace.id, statementType: "PNL" },
    });
    const patrimoniais = await prisma.accountingAccount.count({
      where: { workspaceId: workspace.id, statementType: "BALANCE_SHEET" },
    });
    const erradas = await prisma.accountingAccount.count({
      where: {
        workspaceId: workspace.id,
        OR: [
          { accountType: { in: ["ASSET", "EXPENSE"] }, normalBalance: "CREDIT" },
          { accountType: { in: ["LIABILITY", "EQUITY", "REVENUE"] }, normalBalance: "DEBIT" },
        ],
      },
    });
    console.log(`\n${naDre} conta(s) de resultado (DRE) · ${patrimoniais} patrimonial(is)`);
    console.log(erradas === 0 ? "✓ saldo normal coerente em todas as contas" : `✗ ${erradas} conta(s) com saldo normal incoerente`);
  });

  const { prisma: db } = await import("@/lib/prisma");
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
