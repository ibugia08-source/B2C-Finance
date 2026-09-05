import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createOwner, createMrrClient, createBilling, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import { getReceiptsSummary } from "@/lib/services/revenue-metrics";
import {
  getDashboardMainMetrics,
  getYearlySeries,
} from "@/lib/services/dashboard-main";
import type { Period } from "@/lib/period";

/**
 * UM SÓ "RECEBIDO" (02 §5.5): o card "Recebido em caixa" da Visão Geral e o
 * "Recebido no mês" da Gestão do Mês são a MESMA conta — totalRevenue do
 * dicionário. O caso que os separava: RECUPERAÇÃO (cobrança de competência
 * anterior paga neste mês) entrava numa tela e não na outra.
 *
 * E a recuperação NUNCA abate o "Em aberto" do mês atual — o aberto é da
 * competência.
 *
 * Competências 2033-04/05: exclusivas desta suíte.
 */

const ABRIL = { start: new Date(2033, 3, 1), end: new Date(2033, 4, 1) };
const MAIO = { start: new Date(2033, 4, 1), end: new Date(2033, 5, 1) };
const periodo = (r: { start: Date; end: Date }): Period =>
  ({ key: "custom", start: r.start, end: r.end, label: "" }) as Period;

let dono: TestOwner;
let clienteId = "";

beforeAll(async () => {
  dono = await createOwner();
  await asOwner(dono, async () => {
    const cliente = await createMrrClient(dono, { name: "Cliente Recuperado" });
    clienteId = cliente.id;
    const cobranca = await createBilling(dono, cliente.id, {
      month: 4,
      year: 2033,
      amount: 300,
    });
    // Pagamento em MAIO de uma cobrança de ABRIL = recuperação.
    await prisma.payment.create({
      data: {
        billingId: cobranca.id,
        amount: 300,
        paidAt: new Date(2033, 4, 10),
        status: "CONFIRMED",
      },
    });
    await prisma.billing.update({
      where: { id: cobranca.id },
      data: { status: "PAID", paidTotal: 300 },
    });
  });
});

afterAll(async () => {
  await runWithoutScope(async () => {
    await prisma.payment.deleteMany({ where: { billing: { clientId: clienteId } } });
    await prisma.billing.deleteMany({ where: { clientId: clienteId } });
    await prisma.client.deleteMany({ where: { id: clienteId } });
  });
  await destroyOwner(dono);
});

describe("recebido consistente entre Visão Geral e Gestão do Mês", () => {
  it("a recuperação entra no Recebido dos DOIS lugares, com o mesmo número", async () => {
    await asOwner(dono, async () => {
      const resumo = await getReceiptsSummary(MAIO.start, MAIO.end);
      expect(resumo.totalRevenue).toBe(300); // Gestão do Mês
      expect(resumo.extraRevenueAutomatic).toBe(300);

      const painel = await getDashboardMainMetrics(periodo(MAIO));
      expect(painel.current.recebido).toBe(resumo.totalRevenue); // Visão Geral
      expect(painel.current.recuperado).toBe(300);
    });
  });

  it("a recuperação NÃO abate o Em aberto do mês em que o dinheiro caiu", async () => {
    await asOwner(dono, async () => {
      const painel = await getDashboardMainMetrics(periodo(MAIO));
      const M = painel.current;
      // Em aberto na base de competência: recebido − recuperado é o que veio
      // DE MAIO; só isso abate o previsto de maio.
      expect(M.emAberto).toBe(
        Math.max(0, M.faturamentoTotal - (M.recebido - M.recuperado))
      );
      // Nada de maio foi pago — o aberto de maio é o previsto inteiro.
      expect(M.emAberto).toBe(M.faturamentoTotal);
    });
  });

  it("a série anual conta a recuperação no mês do CAIXA, com série própria", async () => {
    await asOwner(dono, async () => {
      const serie = await getYearlySeries(2033);
      expect(serie.recebido[4]).toBe(300); // maio (índice 4)
      expect(serie.recuperado[4]).toBe(300);
      expect(serie.recebido[3]).toBe(0); // abril não ganha o dinheiro de maio
    });
  });
});
