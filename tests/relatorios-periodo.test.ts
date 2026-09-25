import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  asOwner, createBilling, createOwner, createMrrClient, destroyOwner, prisma, type TestOwner,
} from "./support/db";
import { formatBRL } from "@/lib/format";
import type { ReportQuery } from "@/lib/reports/query";

vi.mock("next/cache", async (orig) => ({
  ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {},
}));

/**
 * RELATÓRIOS × PERÍODO (25/09/2026).
 *
 * - Executivo: "Resultado bruto" = faturamento do PERÍODO − despesas do
 *   PERÍODO (antes subtraía só o primeiro mês de despesa).
 * - TCV: cobrança entra pela COMPETÊNCIA (como o card do Dashboard), não
 *   pelo vencimento.
 * - Filtros sem sentido para a fonte saíram (financeiro-mensal: cliente;
 *   contratos: situação).
 *
 * Competências de 2035: exclusivas desta suíte.
 */

const q = (start: Date, end: Date): ReportQuery =>
  ({
    period: { key: "custom", start, end, label: "", parcial: false, decorridoAte: null, preset: "custom" },
  }) as ReportQuery;
const TRI = q(new Date(2035, 0, 1), new Date(2035, 3, 1)); // jan–mar/2035
const FEV = q(new Date(2035, 1, 1), new Date(2035, 2, 1));

let dono: TestOwner;

beforeAll(async () => {
  dono = await createOwner();
  const c = await createMrrClient(dono, { name: "Cliente TCV", monthlyValue: 0, startedAt: new Date(2030, 0, 1) });
  // TCV de competência FEVEREIRO que vence em MARÇO.
  await createBilling(dono, c.id, {
    month: 2, year: 2035, amount: 12000, revenueType: "TCV", dueDate: new Date(2035, 2, 10),
    description: "TCV fevereiro",
  });
  // Uma despesa por mês do trimestre: 100 + 200 + 300.
  await asOwner(dono, async () => {
    for (const [m, v] of [[0, 100], [1, 200], [2, 300]] as const)
      await prisma.transaction.create({
        data: {
          type: "despesa", description: `Despesa ${m + 1}`, amount: v,
          date: new Date(2035, m, 5), status: "pendente",
        },
      });
  });
});
afterAll(async () => {
  await destroyOwner(dono);
});

describe("relatório TCV — por competência", () => {
  it("cobrança de competência fevereiro entra em fevereiro, mesmo vencendo em março", async () => {
    const { tcvReport } = await import("@/lib/reports/definitions/tcv");
    const fev = await asOwner(dono, async () => tcvReport.build(FEV));
    expect(fev.map((r) => r.descricao)).toContain("TCV fevereiro");
    const mar = await asOwner(dono, async () =>
      tcvReport.build(q(new Date(2035, 2, 1), new Date(2035, 3, 1)))
    );
    expect(mar.map((r) => r.descricao)).not.toContain("TCV fevereiro");
  });
});

describe("relatório executivo — despesas do período inteiro", () => {
  it("trimestre: despesas = soma dos 3 meses e o resultado usa essa soma", async () => {
    const { executivoReport } = await import("@/lib/reports/definitions/executivo");
    const rows = await asOwner(dono, async () => executivoReport.build(TRI));
    const valor = (indicador: string) => rows.find((r) => r.indicador === indicador)?.valor;
    expect(valor("Despesas do período")).toBe(formatBRL(600));
    const fat = rows.find((r) => r.indicador === "Faturamento total")!.valor as string;
    const fatNum = Number(fat.replace(/[^\d,-]/g, "").replace(",", "."));
    expect(valor("Resultado bruto (fat. − desp.)")).toBe(formatBRL(fatNum - 600));
  });
});

describe("filtros que não se aplicam à fonte saíram", () => {
  it("financeiro-mensal sem cliente; contratos sem situação", async () => {
    const { financeiroMensalReport } = await import("@/lib/reports/definitions/financeiro-mensal");
    const { contratosReport } = await import("@/lib/reports/definitions/contratos");
    expect(financeiroMensalReport.filterFields).not.toContain("cliente");
    expect(contratosReport.filterFields).not.toContain("situacao");
  });
});
