import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { POSTING_RULES, getPostingRule, POSTING_RULES_VERSION, LEDGER_FLAG } from "@/lib/accounting/posting-rules";
import { post, reverse, checkLedgerBalance, idempotencyKeyOf, isLedgerEnabled } from "@/lib/accounting/engine";
import { prisma, runWithoutScope, createOwner, destroyOwner, type TestOwner } from "./support/db";

/**
 * ACCOUNTING ENGINE — ref. 01 §3.10-3.11, §4.9.
 * O que estes testes travam é a razão de o motor existir: partida dobrada
 * fechada, um fato postado uma vez só, correção por reversão (nunca apagando)
 * e a separação entre reconhecer e pagar.
 */

let workspaceId: string;
let owner: TestOwner;

async function setFlag(enabled: boolean) {
  await runWithoutScope(async () =>
    prisma.featureFlag.updateMany({
      where: { workspaceId, key: LEDGER_FLAG },
      data: { enabled },
    })
  );
}

async function limparRazao() {
  await runWithoutScope(async () => {
    await prisma.ledgerEntry.deleteMany({});
    await prisma.ledgerTransaction.deleteMany({});
  });
}

beforeAll(async () => {
  owner = await createOwner();
  const ws = await runWithoutScope(async () =>
    prisma.workspace.findFirstOrThrow({ select: { id: true } })
  );
  workspaceId = ws.id;
});
afterAll(async () => {
  await limparRazao();
  await setFlag(false);
  await destroyOwner(owner);
});
beforeEach(async () => {
  await limparRazao();
});

const fato = (over: Partial<Parameters<typeof post>[0]> = {}) => ({
  eventType: "REVENUE_RECOGNIZED" as const,
  sourceType: "Billing",
  sourceId: "billing-teste-1",
  competence: "2026-03",
  amount: 1000,
  context: { workspaceId, ownerId: owner.id },
  ...over,
});

describe("matriz canônica (regras puras)", () => {
  it("cobre os 17 eventos da especificação, sem repetir", () => {
    expect(POSTING_RULES).toHaveLength(17);
    const tipos = POSTING_RULES.map((r) => r.eventType);
    expect(new Set(tipos).size).toBe(tipos.length);
  });

  it("separa reconhecer de pagar: pagar dívida reconhecida NÃO entra na DRE", () => {
    // A regra que impede a dupla contagem (01 §2.6).
    expect(getPostingRule("EXPENSE_RECOGNIZED_ON_CREDIT").affectsPnl).toBe(true);
    expect(getPostingRule("PAYABLE_SETTLED").affectsPnl).toBe(false);
    expect(getPostingRule("CARD_PURCHASE").affectsPnl).toBe(true);
    expect(getPostingRule("CARD_INVOICE_PAID").affectsPnl).toBe(false);
    expect(getPostingRule("TAX_PROVISIONED").affectsPnl).toBe(true);
    expect(getPostingRule("TAX_PAID").affectsPnl).toBe(false);
  });

  it("empréstimo não é receita e principal não é despesa; juros são", () => {
    expect(getPostingRule("LOAN_RECEIVED").affectsPnl).toBe(false);
    expect(getPostingRule("LOAN_PRINCIPAL_PAID").affectsPnl).toBe(false);
    expect(getPostingRule("INTEREST_EXPENSE").affectsPnl).toBe(true);
  });

  it("transferência entre contas não toca no resultado", () => {
    expect(getPostingRule("ACCOUNT_TRANSFER").affectsPnl).toBe(false);
  });

  it("recebimento de cliente não reconhece receita de novo", () => {
    expect(getPostingRule("REVENUE_RECOGNIZED").affectsPnl).toBe(true);
    expect(getPostingRule("CUSTOMER_PAYMENT_RECEIVED").affectsPnl).toBe(false);
  });

  it("evento fora da matriz é erro explícito", () => {
    expect(() => getPostingRule("NAO_EXISTE" as any)).toThrow(/matriz canônica/i);
  });
});

describe("bandeira ledger_enabled", () => {
  it("nasce desligada e o motor NÃO grava nada", async () => {
    await setFlag(false);
    expect(await isLedgerEnabled(workspaceId)).toBe(false);

    const r = await post(fato());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.posted).toBe(false);
    if (r.posted === false) expect(r.reason).toBe("flag_desligada");

    const n = await runWithoutScope(async () => prisma.ledgerTransaction.count());
    expect(n).toBe(0);
  });
});

describe("postagem no razão (bandeira ligada)", () => {
  beforeEach(async () => { await setFlag(true); });

  it("grava partida dobrada com débito igual ao crédito", async () => {
    const r = await post(fato({ amount: 1500 }));
    expect(r.ok).toBe(true);
    if (!r.ok || !r.posted) throw new Error("não postou");

    const t = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findUniqueOrThrow({
        where: { id: r.ledgerTransactionId },
        include: { entries: { include: { account: { select: { code: true } } } } },
      })
    );
    expect(t.entries).toHaveLength(2);
    expect(t.competence).toBe("2026-03");
    expect(t.postingRuleVersion).toBe(POSTING_RULES_VERSION);

    const debito = t.entries.find((e) => Number(e.debit) > 0)!;
    const credito = t.entries.find((e) => Number(e.credit) > 0)!;
    expect(Number(debito.debit)).toBe(1500);
    expect(Number(credito.credit)).toBe(1500);
    // Receita reconhecida: nasce o recebível (1.3) contra a receita (4.1).
    expect(debito.account.code).toBe("1.3");
    expect(credito.account.code).toBe("4.1");
  });

  it("o mesmo fato posta UMA vez só", async () => {
    const primeiro = await post(fato());
    const segundo = await post(fato());
    expect(primeiro.ok && primeiro.posted).toBe(true);
    expect(segundo.ok).toBe(true);
    if (segundo.ok && segundo.posted === false) expect(segundo.reason).toBe("ja_postado");

    const n = await runWithoutScope(async () => prisma.ledgerTransaction.count());
    expect(n).toBe(1);
  });

  it("a chave de idempotência inclui evento, origem e competência", () => {
    const chave = idempotencyKeyOf({
      eventType: "REVENUE_RECOGNIZED", sourceType: "Billing",
      sourceId: "abc", competence: "2026-03",
    });
    expect(chave).toBe("REVENUE_RECOGNIZED:Billing:abc:2026-03");
  });

  it("recusa valor não positivo e competência malformada", async () => {
    const zero = await post(fato({ amount: 0 }));
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error).toMatch(/positivo/i);

    const comp = await post(fato({ competence: "2026-3", sourceId: "b2" }));
    expect(comp.ok).toBe(false);
    if (!comp.ok) expect(comp.error).toMatch(/competência inválida/i);
  });

  it("recusa evento que ainda não é implementado pelo motor", async () => {
    const r = await post(fato({ eventType: "CARD_INVOICE_PAID", sourceId: "fatura-1" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/ainda não é postado/i);
  });

  it("recusa lançamento em conta sintética", async () => {
    // "4" é a conta-mãe de receitas: só agrega, não recebe lançamento.
    const r = await post(fato({ context: { workspaceId, ownerId: owner.id, creditAccountCode: "4" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/sintética/i);
  });

  it("recusa conta inexistente no plano", async () => {
    const r = await post(fato({ context: { workspaceId, debitAccountCode: "99.99.99" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/não existe no plano/i);
  });

  it("o banco recusa lançamento com os dois lados preenchidos", async () => {
    const r = await post(fato());
    if (!r.ok || !r.posted) throw new Error("não postou");
    await expect(
      runWithoutScope(async () =>
        prisma.ledgerEntry.create({
          data: {
            ledgerTransactionId: r.ledgerTransactionId,
            accountId: (await prisma.accountingAccount.findFirstOrThrow({
              where: { workspaceId, code: "1.1" }, select: { id: true },
            })).id,
            debit: 10, credit: 10, // proibido: um lado só
          },
        })
      )
    ).rejects.toThrow();
  });
});

describe("reversão (correção com rastro)", () => {
  beforeEach(async () => { await setFlag(true); });

  it("neutraliza invertendo as contas e PRESERVA a original", async () => {
    const original = await post(fato({ amount: 800 }));
    if (!original.ok || !original.posted) throw new Error("não postou");

    const rev = await reverse(original.ledgerTransactionId, "erro de lançamento");
    expect(rev.ok && rev.posted).toBe(true);
    if (!rev.ok || !rev.posted) return;

    const [antiga, nova] = await runWithoutScope(async () =>
      Promise.all([
        prisma.ledgerTransaction.findUniqueOrThrow({
          where: { id: original.ledgerTransactionId },
          include: { entries: true },
        }),
        prisma.ledgerTransaction.findUniqueOrThrow({
          where: { id: rev.ledgerTransactionId },
          include: { entries: true },
        }),
      ])
    );
    // A original continua lá, intacta.
    expect(antiga.entries).toHaveLength(2);
    expect(nova.reversalOfId).toBe(antiga.id);
    expect(nova.eventType).toBe("REVERSAL");

    // Soma das duas = zero em cada conta.
    const porConta = new Map<string, number>();
    for (const e of [...antiga.entries, ...nova.entries]) {
      porConta.set(e.accountId, (porConta.get(e.accountId) ?? 0) + Number(e.debit) - Number(e.credit));
    }
    for (const saldo of porConta.values()) expect(saldo).toBe(0);
  });

  it("exige motivo e não reverte duas vezes", async () => {
    const original = await post(fato({ amount: 500 }));
    if (!original.ok || !original.posted) throw new Error("não postou");

    const semMotivo = await reverse(original.ledgerTransactionId, "   ");
    expect(semMotivo.ok).toBe(false);

    await reverse(original.ledgerTransactionId, "motivo");
    const segunda = await reverse(original.ledgerTransactionId, "motivo");
    expect(segunda.ok).toBe(true);
    if (segunda.ok && segunda.posted === false) expect(segunda.reason).toBe("ja_postado");
  });
});

describe("conferência do razão", () => {
  it("acusa razão balanceado depois de vários lançamentos", async () => {
    await setFlag(true);
    await post(fato({ sourceId: "b1", amount: 100 }));
    await post(fato({ sourceId: "b2", amount: 250.55 }));
    await post(fato({
      eventType: "CUSTOMER_PAYMENT_RECEIVED", sourceType: "Payment",
      sourceId: "p1", amount: 100,
    }));

    const r = await checkLedgerBalance(workspaceId);
    expect(r.ok).toBe(true);
    expect(r.transacoes).toBe(3);
    expect(r.desbalanceadas).toHaveLength(0);
  });
});
