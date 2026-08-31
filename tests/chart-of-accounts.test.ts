import { describe, it, expect, beforeAll } from "vitest";
import {
  CHART_OF_ACCOUNTS, CATEGORY_TO_ACCOUNT,
  normalBalanceOf, statementTypeOf, rootCode,
} from "../prisma/chart-of-accounts";
import { prisma, runWithoutScope } from "./support/db";

/**
 * PLANO DE CONTAS — ref. 03 §2.2 e 01 §3.11.
 * A natureza das contas é o que impede empréstimo, fatura e transferência de
 * virarem despesa duplicada. Estes testes travam essas invariantes.
 */

describe("natureza das contas (regras puras)", () => {
  it("ativo e despesa têm saldo normal devedor; passivo, PL e receita, credor", () => {
    expect(normalBalanceOf("ASSET")).toBe("DEBIT");
    expect(normalBalanceOf("EXPENSE")).toBe("DEBIT");
    expect(normalBalanceOf("LIABILITY")).toBe("CREDIT");
    expect(normalBalanceOf("EQUITY")).toBe("CREDIT");
    expect(normalBalanceOf("REVENUE")).toBe("CREDIT");
  });

  it("só receita e despesa entram na DRE", () => {
    expect(statementTypeOf("REVENUE")).toBe("PNL");
    expect(statementTypeOf("EXPENSE")).toBe("PNL");
    expect(statementTypeOf("ASSET")).toBe("BALANCE_SHEET");
    expect(statementTypeOf("LIABILITY")).toBe("BALANCE_SHEET");
    expect(statementTypeOf("EQUITY")).toBe("BALANCE_SHEET");
  });

  it("os 15 grupos da especificação existem, mais a conta temporária", () => {
    const raizes = new Set(CHART_OF_ACCOUNTS.map((c) => rootCode(c.code)));
    for (let i = 1; i <= 15; i++) expect(raizes.has(String(i))).toBe(true);
    expect(raizes.has("99")).toBe(true); // Não classificado
  });

  it("nenhum código se repete e todo filho tem pai declarado", () => {
    const codigos = CHART_OF_ACCOUNTS.map((c) => c.code);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const c of codigos) {
      if (!c.includes(".")) continue;
      const pai = c.slice(0, c.lastIndexOf("."));
      expect(codigos).toContain(pai);
    }
  });

  it("o de-para de categorias aponta só para códigos existentes", () => {
    const codigos = new Set(CHART_OF_ACCOUNTS.map((c) => c.code));
    for (const [categoria, codigo] of Object.entries(CATEGORY_TO_ACCOUNT)) {
      expect(codigos.has(codigo), `${categoria} → ${codigo}`).toBe(true);
    }
  });
});

describe("plano de contas no banco", () => {
  let workspaceId: string;

  beforeAll(async () => {
    const ws = await runWithoutScope(async () =>
      prisma.workspace.findFirstOrThrow({ select: { id: true } })
    );
    workspaceId = ws.id;
  });

  it("caixa, reservas, cartões, impostos e empréstimos ficam FORA da DRE", async () => {
    const fora = await runWithoutScope(async () =>
      prisma.accountingAccount.findMany({
        where: { workspaceId, code: { in: ["1.1", "1.2", "2.2", "2.3", "2.5", "15.1", "15.2"] } },
        select: { code: true, name: true, statementType: true },
      })
    );
    expect(fora.length).toBe(7);
    for (const c of fora) {
      expect(c.statementType, `${c.code} ${c.name}`).toBe("BALANCE_SHEET");
    }
  });

  it("juros são despesa (DRE) mesmo com o principal fora dela", async () => {
    const [juros, principal] = await runWithoutScope(async () =>
      Promise.all([
        prisma.accountingAccount.findFirstOrThrow({ where: { workspaceId, code: "12.1" } }),
        prisma.accountingAccount.findFirstOrThrow({ where: { workspaceId, code: "2.5" } }),
      ])
    );
    expect(juros.statementType).toBe("PNL");
    expect(juros.accountType).toBe("EXPENSE");
    expect(principal.statementType).toBe("BALANCE_SHEET");
    expect(principal.accountType).toBe("LIABILITY");
  });

  it("toda conta tem saldo normal coerente com o tipo", async () => {
    const incoerentes = await runWithoutScope(async () =>
      prisma.accountingAccount.count({
        where: {
          workspaceId,
          OR: [
            { accountType: { in: ["ASSET", "EXPENSE"] }, normalBalance: "CREDIT" },
            { accountType: { in: ["LIABILITY", "EQUITY", "REVENUE"] }, normalBalance: "DEBIT" },
          ],
        },
      })
    );
    expect(incoerentes).toBe(0);
  });

  it("a hierarquia está montada: 4.1 é filha de 4", async () => {
    const filha = await runWithoutScope(async () =>
      prisma.accountingAccount.findFirstOrThrow({
        where: { workspaceId, code: "4.1" },
        select: { parent: { select: { code: true, isPostingAccount: true } } },
      })
    );
    expect(filha.parent?.code).toBe("4");
    // Conta sintética não recebe lançamento.
    expect(filha.parent?.isPostingAccount).toBe(false);
  });

  it("existe exatamente UMA conta temporária de não classificado", async () => {
    const naoClassificadas = await runWithoutScope(async () =>
      prisma.accountingAccount.findMany({
        where: { workspaceId, isUnclassified: true },
        select: { code: true, name: true },
      })
    );
    expect(naoClassificadas).toHaveLength(1);
    expect(naoClassificadas[0].code).toBe("99");
  });

  it("despesas pessoais do sócio ficam em Distribuições, fora do operacional", async () => {
    const conta = await runWithoutScope(async () =>
      prisma.accountingAccount.findFirstOrThrow({
        where: { workspaceId, code: "3.2" },
        select: { name: true, accountType: true, statementType: true },
      })
    );
    expect(conta.accountType).toBe("EQUITY");
    expect(conta.statementType).toBe("BALANCE_SHEET");
  });
});
