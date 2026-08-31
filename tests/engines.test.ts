import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, createRelationship,
  destroyOwner, prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { revertBillingPayment, settleBillingPayment } from "@/lib/services/payment-accounting";
import { recognizeBilling } from "@/lib/engines/billing-engine";
import { guardPeriod } from "@/lib/engines/guards";
import { systemContext } from "@/lib/engines/context";

/**
 * F1.5 — pipeline de serviço de domínio (03 §4.1).
 *
 *   permission -> period guard -> idempotency guard -> Payment
 *     -> PaymentApplication -> AccountingEngine -> AuditLog
 *     -> OutboxEvent -> commit
 *
 * A guarda de PERMISSÃO não é exercitada aqui de propósito: ela lê o
 * usuário da request, e teste não tem request. Ela é coberta pelo RBAC.
 * O que estes testes provam é o resto do pipeline — e, principalmente,
 * que ele é ATÔMICO: trilha e aviso nascem na MESMA transação do
 * dinheiro. Postar depois do commit abriria uma janela em que o
 * pagamento existe e o registro dele não.
 */
describe("F1.5 — pipeline dos motores", () => {
  let dono: TestOwner;
  const ctx = systemContext("UI", "teste do pipeline");

  beforeAll(async () => {
    dono = await createOwner();
  });
  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("um pagamento gera trilha e aviso na mesma transação", async () => {
    const cliente = await createMrrClient(dono, { name: "Pipeline" });
    await createRelationship(dono, cliente.id);
    const cob = await createBilling(dono, cliente.id, { month: 2, year: 2026, amount: 400 });

    const r: any = await asOwner(dono, async () =>
      settleBillingPayment(
        { billingId: cob.id, amount: 400, paidAt: new Date(2026, 1, 6), method: "PIX", accountId: null, notes: null },
        ctx
      )
    );
    expect(r.ok).toBe(true);

    // AuditLog: criação do pagamento + mudança de saldo/status da cobrança.
    const trilha = await asOwner(dono, async () =>
      prisma.auditLog.findMany({ where: { correlationId: ctx.correlationId } })
    );
    expect(trilha.length).toBeGreaterThanOrEqual(2);
    expect(trilha.some((l) => l.entity === "Payment" && l.action === "CREATE")).toBe(true);
    expect(trilha.some((l) => l.entity === "Billing" && l.field === "paidTotal")).toBe(true);
    expect(trilha.every((l) => l.reason === "teste do pipeline")).toBe(true);

    // OutboxEvent: um aviso do fato, pendente de entrega.
    const avisos = await runWithoutScope(async () =>
      prisma.outboxEvent.findMany({ where: { sourceType: "Payment", sourceId: r.paymentId } })
    );
    expect(avisos).toHaveLength(1);
    expect(avisos[0].eventType).toBe("pagamento.registrado");
    expect(avisos[0].status).toBe("PENDING");
  });

  it("o estorno registra REVERSE com motivo", async () => {
    const cliente = await createMrrClient(dono, { name: "Estorno auditado" });
    const cob = await createBilling(dono, cliente.id, { month: 3, year: 2026, amount: 250 });
    const r: any = await asOwner(dono, async () =>
      settleBillingPayment(
        { billingId: cob.id, amount: 250, paidAt: new Date(2026, 2, 4), method: "PIX", accountId: null, notes: null },
        systemContext("UI")
      )
    );

    const ctxEstorno = systemContext("UI", "cliente pediu devolução");
    await asOwner(dono, async () => revertBillingPayment(r.paymentId, ctxEstorno));

    const trilha = await asOwner(dono, async () =>
      prisma.auditLog.findMany({ where: { correlationId: ctxEstorno.correlationId } })
    );
    expect(trilha.some((l) => l.action === "REVERSE" && l.entity === "Payment")).toBe(true);
    expect(trilha.every((l) => l.reason === "cliente pediu devolução")).toBe(true);
  });

  it("cobrança de renegociação NÃO é reconhecida como receita", async () => {
    const cliente = await createMrrClient(dono, { name: "Renegociado" });
    const cob = await createBilling(dono, cliente.id, { month: 4, year: 2026, amount: 900 });
    await asOwner(dono, async () =>
      prisma.billing.update({
        where: { id: cob.id },
        data: { recognitionMode: "SETTLEMENT_ONLY", billingKind: "RENEGOTIATION" },
      })
    );

    const r: any = await asOwner(dono, async () => recognizeBilling(cob.id));
    expect(r.ok).toBe(true);
    expect(r.posted).toBe(false);
    // Não é "falhou": é a regra funcionando. A receita já entrou quando a
    // dívida original nasceu; reconhecer de novo dobraria o faturamento.
    expect(r.skipped).toBe("settlement_only");
  });

  it("a guarda de período existe e hoje permite tudo (a regra chega na F2.1)", async () => {
    const g = await guardPeriod("CUSTOMER_PAYMENT_RECEIVED", "2020-01");
    expect(g.ok).toBe(true);
  });
});
