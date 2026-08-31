import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, createRelationship,
  destroyOwner, prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { settleBillingPayment } from "@/lib/services/payment-accounting";
import { recognizeBilling } from "@/lib/engines/billing-engine";
import { ledgerHealth, setLedgerEnabled } from "@/lib/accounting/health";
import { currentWorkspaceId } from "@/lib/services/workspace";
import { systemContext } from "@/lib/engines/context";
import { toNumber as n } from "@/lib/format";

/**
 * F1.6 — razão mínimo ligado (01 §3.10, §5.4).
 *
 * O que estes testes travam:
 *  · com a bandeira LIGADA, um pagamento nasce com lançamento e o
 *    lançamento fecha (débito = crédito);
 *  · com a bandeira DESLIGADA, nada é postado — e isso não é falha, é a
 *    fase anterior funcionando;
 *  · a verificação de saúde enxerga as DUAS coisas: balanço e COBERTURA.
 *    Um razão balanceado e vazio passa no balanço e não serve para nada —
 *    é essa a falha real que a bandeira desligada por engano produz.
 */
describe("F1.6 — razão ligado", () => {
  let dono: TestOwner;
  let workspaceId: string;

  beforeAll(async () => {
    dono = await createOwner();
    workspaceId = await currentWorkspaceId();
  });
  afterAll(async () => {
    // Sempre devolve o banco de teste ao estado da spec para esta fase.
    await setLedgerEnabled(workspaceId, false);
    await destroyOwner(dono);
  });

  it("desligada, o pagamento acontece e nada é postado", async () => {
    await setLedgerEnabled(workspaceId, false);
    const cliente = await createMrrClient(dono, { name: "Sem razão" });
    const cob = await createBilling(dono, cliente.id, { month: 5, year: 2026, amount: 300 });

    const r: any = await asOwner(dono, async () =>
      settleBillingPayment(
        { billingId: cob.id, amount: 300, paidAt: new Date(2026, 4, 5), method: "PIX", accountId: null, notes: null },
        systemContext("UI")
      )
    );
    expect(r.ok).toBe(true);

    const lanc = await runWithoutScope(async () =>
      prisma.ledgerTransaction.count({ where: { sourceType: "Payment", sourceId: r.paymentId } })
    );
    expect(lanc).toBe(0);
  });

  it("ligada, o pagamento nasce com lançamento BALANCEADO", async () => {
    await setLedgerEnabled(workspaceId, true);
    const cliente = await createMrrClient(dono, { name: "Com razão" });
    const cob = await createBilling(dono, cliente.id, { month: 6, year: 2026, amount: 750 });

    const r: any = await asOwner(dono, async () =>
      settleBillingPayment(
        { billingId: cob.id, amount: 750, paidAt: new Date(2026, 5, 9), method: "PIX", accountId: null, notes: null },
        systemContext("UI")
      )
    );
    expect(r.ok).toBe(true);

    const transacao = await runWithoutScope(async () =>
      prisma.ledgerTransaction.findFirstOrThrow({
        where: { sourceType: "Payment", sourceId: r.paymentId },
        include: { entries: true },
      })
    );
    expect(transacao.competence).toBe("2026-06");
    expect(transacao.entries).toHaveLength(2);

    const debitos = transacao.entries.reduce((s, e) => s + n(e.debit), 0);
    const creditos = transacao.entries.reduce((s, e) => s + n(e.credit), 0);
    expect(debitos).toBe(750);
    expect(creditos).toBe(750);
    expect(debitos).toBe(creditos);
  });

  it("o mesmo pagamento não posta duas vezes", async () => {
    await setLedgerEnabled(workspaceId, true);
    const cliente = await createMrrClient(dono, { name: "Idempotente" });
    const cob = await createBilling(dono, cliente.id, { month: 7, year: 2026, amount: 100 });
    const r: any = await asOwner(dono, async () =>
      settleBillingPayment(
        { billingId: cob.id, amount: 100, paidAt: new Date(2026, 6, 2), method: "PIX", accountId: null, notes: null },
        systemContext("UI")
      )
    );
    // Reconhecer a MESMA cobrança duas vezes devolve o lançamento existente.
    const a: any = await asOwner(dono, async () => recognizeBilling(cob.id));
    const b: any = await asOwner(dono, async () => recognizeBilling(cob.id));
    expect(a.ok && b.ok).toBe(true);

    const total = await runWithoutScope(async () =>
      prisma.ledgerTransaction.count({ where: { sourceType: "Billing", sourceId: cob.id } })
    );
    expect(total).toBe(1);
  });

  it("a saúde do razão enxerga balanço E cobertura", async () => {
    await setLedgerEnabled(workspaceId, true);
    const h = await ledgerHealth(workspaceId);
    expect(h.enabled).toBe(true);
    expect(h.balanceOk).toBe(true);
    expect(h.desbalanceadas).toHaveLength(0);
    // A cobertura é uma pergunta diferente do balanço: existe e é medida.
    expect(h.cobertura).not.toBeUndefined();
  });
});
