import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  billingFindMany: vi.fn(),
  paymentFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    billing: { findMany: db.billingFindMany },
    payment: { findMany: db.paymentFindMany },
  },
}));

import { relatorioDiario } from "@/lib/api/v1/insights";

describe("relatório diário de recebimentos", () => {
  beforeEach(() => {
    db.billingFindMany.mockReset().mockResolvedValue([]);
    const pagamentos = [
      {
        id: "pagamento-1",
        amount: 1200,
        paidAt: new Date("2026-10-01T00:00:00.000Z"),
        status: "CONFIRMED",
        method: "PIX",
        billing: { id: "cobranca-1", description: "Mensalidade", client: { id: "cliente-1", name: "Cliente de teste" } },
      },
    ];
    db.paymentFindMany.mockReset().mockImplementation(async ({ where }: { where: { paidAt: { gte: Date; lt: Date }; status: string } }) =>
      pagamentos.filter((p) => p.status === where.status && p.paidAt >= where.paidAt.gte && p.paidAt < where.paidAt.lt)
    );
  });

  it("atribui um pagamento civil de 01/10 ao dia 01/10, sem deslocá-lo para 30/09", async () => {
    const diaPagamento = await relatorioDiario("2026-10-01", ["receivables.read"]);
    expect((diaPagamento.data.receivables as { received: { count: number; amount: number } }).received).toMatchObject({ count: 1, amount: 1200 });

    const diaAnterior = await relatorioDiario("2026-09-30", ["receivables.read"]);
    expect((diaAnterior.data.receivables as { received: { count: number; amount: number } }).received).toMatchObject({ count: 0, amount: 0 });
  });
});
