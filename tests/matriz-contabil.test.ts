import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POSTING_RULES, getPostingRule } from "@/lib/accounting/posting-rules";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner, prisma,
  type TestOwner,
} from "./support/db";
import { runWithoutScope } from "@/lib/auth/owner-scope";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { isLedgerEnabled, post, reverter } from "@/lib/accounting/engine";
import { setLedgerEnabled } from "@/lib/accounting/health";
import { revertBillingPayment, settleBillingPayment } from "@/lib/services/payment-accounting";

/**
 * F3.1 — a matriz canônica inteira (01 §3.10-§3.11).
 *
 * O teste que mais vale aqui é o da NATUREZA. O erro que ele evita é o mais
 * caro da contabilidade gerencial e o mais difícil de perceber: dinheiro que
 * SAI e não é despesa. Pagar a fatura do cartão, amortizar empréstimo e
 * transferir para a reserva movimentam caixa e não são custo — a compra no
 * cartão já virou despesa quando foi feita. Lançar qualquer um deles no
 * resultado conta a mesma saída duas vezes.
 */
describe("F3.1 — matriz canônica de eventos", () => {
  it("os 17 eventos de §3.10 estão na matriz", () => {
    expect(POSTING_RULES).toHaveLength(17);
    for (const nome of [
      "REVENUE_RECOGNIZED", "CUSTOMER_PAYMENT_RECEIVED", "EXTRA_REVENUE_RECEIVED",
      "EXPENSE_RECOGNIZED_ON_CREDIT", "EXPENSE_PAID_CASH", "PAYABLE_SETTLED",
      "CARD_PURCHASE", "CARD_INVOICE_PAID", "LOAN_RECEIVED", "LOAN_PRINCIPAL_PAID",
      "INTEREST_EXPENSE", "ACCOUNT_TRANSFER", "TAX_PROVISIONED", "TAX_PAID",
      "CUSTOMER_REFUND", "RECEIVABLE_WRITE_OFF", "REVERSAL",
    ]) {
      expect(() => getPostingRule(nome as any), nome).not.toThrow();
    }
  });

  it("o motor sabe postar todos — nenhum ficou para trás", () => {
    for (const r of POSTING_RULES) {
      expect(r.implemented, r.eventType).toBe(true);
    }
  });

  it("toda regra aponta para contas que EXISTEM e recebem lançamento", async () => {
    const ws = await currentWorkspaceId();
    // REVERSAL fica de fora: ele é o único evento SEM contas próprias, e por
    // um motivo que é a regra inteira — ele não sabe o que está desfazendo
    // até olhar o original. Dar a ele um par fixo produziria um estorno que
    // neutraliza a transação errada, e aí o razão fecha e o DRE mente.
    for (const r of POSTING_RULES.filter((x) => x.eventType !== "REVERSAL")) {
      const contas = await runWithoutScope(async () =>
        prisma.accountingAccount.findMany({
          where: { workspaceId: ws, code: { in: [r.debitAccountCode, r.creditAccountCode] } },
          select: { code: true, isPostingAccount: true, statementType: true },
        })
      );
      expect(contas.length, `${r.eventType}: contas ${r.debitAccountCode}/${r.creditAccountCode}`).toBe(2);
      for (const c of contas) {
        expect(c.isPostingAccount, `${r.eventType}: ${c.code} é sintética`).toBe(true);
      }
    }
  });

  it("NATUREZA: o que não afeta a DRE não toca em conta de resultado", async () => {
    const ws = await currentWorkspaceId();
    for (const r of POSTING_RULES.filter((x) => x.eventType !== "REVERSAL" && !x.affectsPnl)) {
      const contas = await runWithoutScope(async () =>
        prisma.accountingAccount.findMany({
          where: { workspaceId: ws, code: { in: [r.debitAccountCode, r.creditAccountCode] } },
          select: { code: true, name: true, statementType: true },
        })
      );
      const noResultado = contas.filter((c) => c.statementType === "PNL");
      expect(
        noResultado.map((c) => `${r.eventType} → ${c.code} ${c.name}`),
        "saída de caixa que não é despesa não pode entrar no resultado"
      ).toEqual([]);
    }
  });

  it("NATUREZA: o que afeta a DRE toca em pelo menos uma conta de resultado", async () => {
    // A metade que se esquece: despesa lançada entre duas contas de balanço
    // some do resultado sem ninguém notar.
    const ws = await currentWorkspaceId();
    for (const r of POSTING_RULES.filter((x) => x.eventType !== "REVERSAL" && x.affectsPnl)) {
      const contas = await runWithoutScope(async () =>
        prisma.accountingAccount.findMany({
          where: { workspaceId: ws, code: { in: [r.debitAccountCode, r.creditAccountCode] } },
          select: { code: true, statementType: true },
        })
      );
      expect(
        contas.some((c) => c.statementType === "PNL"),
        `${r.eventType} deveria aparecer na DRE e não aparece`
      ).toBe(true);
    }
  });

  it("o motor RECUSA uma regra que viole a natureza", async () => {
    const ws = await currentWorkspaceId();
    // Transferência entre contas apontando para uma conta de despesa: é
    // exatamente a saída contada duas vezes que §3.11 manda impedir.
    const despesa = await runWithoutScope(async () =>
      prisma.accountingAccount.findFirst({
        where: { workspaceId: ws, statementType: "PNL", isPostingAccount: true },
        select: { code: true },
      })
    );
    const r = await post({
      eventType: "ACCOUNT_TRANSFER",
      sourceType: "Teste",
      sourceId: "natureza-1",
      competence: "2026-03",
      amount: 100,
      context: { workspaceId: ws, debitAccountCode: despesa!.code },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/duas vezes|resultado/i);
  });

  it("valor zero ou negativo é recusado — o lado é da regra, não do sinal", async () => {
    const ws = await currentWorkspaceId();
    for (const v of [0, -50]) {
      const r = await post({
        eventType: "ACCOUNT_TRANSFER",
        sourceType: "Teste",
        sourceId: `sinal-${v}`,
        competence: "2026-03",
        amount: v,
        context: { workspaceId: ws },
      });
      expect(r.ok).toBe(false);
    }
  });
});

describe("F3.1 — estorno neutraliza, não apaga (§2.14, §3.10)", () => {
  let dono: TestOwner;
  let ligadoAntes = false;

  beforeAll(async () => {
    dono = await createOwner();
    const ws = await currentWorkspaceId();
    ligadoAntes = await isLedgerEnabled(ws);
    await setLedgerEnabled(ws, true);
  });
  afterAll(async () => {
    const ws = await currentWorkspaceId();
    await setLedgerEnabled(ws, ligadoAntes);
    await destroyOwner(dono);
  });

  it("o lançamento original FICA e ganha um espelho", async () => {
    const cliente = await createMrrClient(dono, { name: "Estorno no razão" });
    const cob = await createBilling(dono, cliente.id, { month: 10, year: 2026, amount: 250 });

    const pago: any = await asOwner(dono, async () =>
      settleBillingPayment({
        billingId: cob.id, amount: 250, paidAt: new Date(2026, 9, 10),
        method: "PIX", accountId: null, notes: null,
      })
    );
    expect(pago.ok).toBe(true);

    const original = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findFirst({
        where: { sourceType: "Payment", sourceId: pago.paymentId, eventType: "CUSTOMER_PAYMENT_RECEIVED" },
        include: { entries: true },
      })
    );
    expect(original).toBeTruthy();

    await asOwner(dono, async () => revertBillingPayment(pago.paymentId));

    // O original CONTINUA lá — apagar faria o razão de um mês fechado mudar
    // sozinho, que é o que a fotografia existe para impedir.
    const aindaLa = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findUnique({ where: { id: original!.id } })
    );
    expect(aindaLa).toBeTruthy();

    const espelho = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findFirst({
        where: { reversalOfId: original!.id },
        include: { entries: true },
      })
    );
    expect(espelho).toBeTruthy();
    expect(espelho!.eventType).toBe("REVERSAL");
    // Mesma competência do original: estorno em outro mês deixaria receita
    // sobrando num mês e estorno sobrando no outro.
    expect(espelho!.competence).toBe(original!.competence);

    // Débito e crédito trocados, e a soma dos dois é zero.
    const soma = [...original!.entries, ...espelho!.entries].reduce(
      (s, e) => s + Number(e.debit) - Number(e.credit),
      0
    );
    expect(soma).toBe(0);
  });

  it("estornar duas vezes o mesmo lançamento não inverte o sinal", async () => {
    const original = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findFirst({
        where: { eventType: "CUSTOMER_PAYMENT_RECEIVED", reversedBy: { isNot: null } },
        select: { id: true },
      })
    );
    const r = await reverter(original!.id, "tentativa de estorno duplo");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.posted).toBe(false);
  });

  it("estorno de estorno não existe", async () => {
    const espelho = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findFirst({ where: { eventType: "REVERSAL" }, select: { id: true } })
    );
    const r = await reverter(espelho!.id, "não deveria dar");
    expect(r.ok).toBe(false);
  });
});
