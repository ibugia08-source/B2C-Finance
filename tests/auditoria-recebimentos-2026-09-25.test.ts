import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  prisma, runWithoutScope, createOwner, destroyOwner, createMrrClient, createBilling,
  asOwner, type TestOwner,
} from "./support/db";
import { hojeCivil, hojeCivilParaGravar, mesCivilAtual } from "@/lib/civil-date";
import { quickSettlePaidAt } from "@/lib/engines/payment-engine";
import { cycleStatusOf } from "@/lib/services/receivables-cycle";
import { competenceOf, competenceOfCivil, competenciasDoPeriodo } from "@/lib/competence";
import { settleBillingPayment } from "@/lib/services/payment-accounting";
import { getReceiptsSummary } from "@/lib/services/revenue-metrics";
import { toNumber as n } from "@/lib/format";

/**
 * AUDITORIA DE RECEBIMENTOS (25/09/2026) — o que cada achado corrigido garante.
 * Anos 2035/2036: exclusivos desta suíte.
 */

vi.mock("@/lib/auth/viewer", () => {
  const v = { id: "teste", name: "Teste", email: "teste@b2c.local", role: "ADMIN", permissions: [], personId: null };
  return {
    requirePermission: async () => v,
    tryPermission: async () => v,
    getViewer: async () => v,
    NO_PERMISSION: { ok: false, error: "Sem permissão." },
    can: () => true,
  };
});
vi.mock("@/lib/revalidate", () => ({
  revalidateAgency: () => {}, revalidateFinance: () => {}, revalidateClients: () => {},
  revalidateCatalog: () => {}, revalidatePayroll: () => {},
}));
vi.mock("next/cache", async (orig) => ({ ...(await orig<any>()), revalidatePath: () => {}, revalidateTag: () => {} }));

const ymdUTC = (d: Date) => d.toISOString().slice(0, 10);
const civilYmd = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
const form = (f: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(f)) fd.set(k, v);
  return fd;
};

// ===================================================================
// 1-3. Regras puras de data (instantes explícitos — não dependem do TZ)
// ===================================================================

describe("hoje civil (achado 1)", () => {
  it("22h da Bahia em 10/09 (01:00Z de 11/09) ainda é dia 10", () => {
    const agora = new Date("2026-09-11T01:00:00Z");
    expect(ymdUTC(hojeCivil(agora))).toBe("2026-09-10");
    expect(civilYmd(hojeCivilParaGravar(agora))).toBe("2026-09-10");
  });
  it("30/09 às 22h da Bahia: o mês corrente ainda é setembro", () => {
    expect(mesCivilAtual(new Date("2026-10-01T01:00:00Z"))).toEqual({ year: 2026, month: 9 });
  });
  it("cobrança que vence hoje não fica vencida depois das 21h", () => {
    const r = cycleStatusOf(
      {
        id: "x", status: "PENDING", isLate: false, paidInDifferentMonth: false,
        dueDate: new Date("2026-09-10T00:00:00Z"), paidAt: null,
      },
      new Date("2026-09-11T01:00:00Z")
    );
    expect(r.status).toBe("UPCOMING");
    const amanha = cycleStatusOf(
      {
        id: "x", status: "PENDING", isLate: false, paidInDifferentMonth: false,
        dueDate: new Date("2026-09-10T00:00:00Z"), paidAt: null,
      },
      new Date("2026-09-11T13:00:00Z")
    );
    expect(amanha).toEqual({ status: "OVERDUE", daysLate: 1 });
  });
});

describe("1 clique grava o DIA civil (achado 2)", () => {
  it("último dia do mês às 22h da Bahia: paga no dia 30, não em outubro", () => {
    const agora = new Date("2026-10-01T01:00:00Z"); // 30/09 22h Bahia
    const due = new Date("2026-09-30T00:00:00Z");
    const paidAt = quickSettlePaidAt(2026, 9, due, agora);
    expect(civilYmd(paidAt)).toBe("2026-09-30");
  });
  it("competência passada continua usando o vencimento", () => {
    const due = new Date("2026-08-10T00:00:00Z");
    expect(quickSettlePaidAt(2026, 8, due, new Date("2026-09-11T01:00:00Z"))).toBe(due);
  });
});

describe("competência de data civil (achado 3)", () => {
  it("despesa do dia 1º gravada a 00:00Z é do próprio mês", () => {
    const d = new Date("2026-09-01T00:00:00Z");
    expect(competenceOf(d)).toBe("2026-08"); // o defeito: instante lido na Bahia
    expect(competenceOfCivil(d)).toBe("2026-09");
  });
  it("período de setembro (construtores locais) cobre só setembro", () => {
    expect(competenciasDoPeriodo(new Date(2026, 8, 1), new Date(2026, 9, 1))).toEqual(["2026-09"]);
    expect(competenciasDoPeriodo(new Date(2026, 10, 1), new Date(2027, 1, 1))).toEqual([
      "2026-11", "2026-12", "2027-01",
    ]);
  });
});

// ===================================================================
// Banco
// ===================================================================

let owner: TestOwner;
let billings: typeof import("@/lib/actions/billings");
let inline: typeof import("@/lib/actions/receivables-inline");
let incomes: typeof import("@/lib/actions/incomes");
let payroll: typeof import("@/lib/actions/payroll");
let complemento: typeof import("@/lib/services/payroll-complement");
let ciclo: typeof import("@/lib/services/receivables-cycle");

beforeAll(async () => {
  owner = await createOwner();
  billings = await import("@/lib/actions/billings");
  inline = await import("@/lib/actions/receivables-inline");
  incomes = await import("@/lib/actions/incomes");
  payroll = await import("@/lib/actions/payroll");
  complemento = await import("@/lib/services/payroll-complement");
  ciclo = await import("@/lib/services/receivables-cycle");
});
afterAll(async () => {
  await runWithoutScope(async () => {
    await prisma.payrollItem.deleteMany({ where: { payroll: { ownerId: owner.id } } });
    await prisma.payroll.deleteMany({ where: { ownerId: owner.id } });
    await prisma.transaction.deleteMany({ where: { ownerId: owner.id } });
  });
  await destroyOwner(owner);
});

const pay = (billingId: string, amount: number, paidAt: Date) =>
  settleBillingPayment({ billingId, amount, paidAt, method: "PIX", accountId: null, notes: null });
const ler = (id: string) =>
  asOwner(owner, async () => prisma.billing.findUniqueOrThrow({ where: { id } }));

describe("atraso compara DIAS civis (achado 2)", () => {
  it("pagar no dia do vencimento não é 'com atraso', mesmo com horas diferentes", async () => {
    const c = await createMrrClient(owner);
    const b = await createBilling(owner, c.id, {
      month: 3, year: 2035, amount: 100, dueDate: new Date("2035-03-10T00:00:00Z"),
    });
    const r: any = await asOwner(owner, () => pay(b.id, 100, new Date("2035-03-10T03:00:00Z")));
    expect(r.ok).toBe(true);
    expect(r.isLate).toBe(false);
    expect(r.paidInDifferentMonth).toBe(false);
  });
});

describe("pagamento acima do saldo (achado 4)", () => {
  it("o excedente sem destino NÃO infla o Recebido da competência", async () => {
    const c = await createMrrClient(owner, { name: "Pagou a mais sozinho" });
    const b = await createBilling(owner, c.id, { month: 5, year: 2035, amount: 500 });
    const r: any = await asOwner(owner, () => pay(b.id, 800, new Date(2035, 4, 5)));
    expect(r.creditRemaining).toBe(300);
    const resumo = await asOwner(owner, () =>
      getReceiptsSummary(new Date(2035, 4, 1), new Date(2035, 5, 1), { clientId: c.id })
    );
    expect(resumo.receiptsCorrectMonth).toBe(500);
    expect(resumo.openMonth).toBe(0);
  });

  it("o toast diz o que aconteceu: abatido da próxima cobrança", async () => {
    const c = await createMrrClient(owner, { name: "Pagou a mais com próxima" });
    const b1 = await createBilling(owner, c.id, { month: 6, year: 2035, amount: 500 });
    const b2 = await createBilling(owner, c.id, { month: 7, year: 2035, amount: 500 });
    const res: any = await asOwner(owner, () =>
      billings.registerBillingPayment(
        form({ billingId: b1.id, amount: "700,00", paidAt: "05/06/2035", method: "PIX" })
      )
    );
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/abatidos da próxima cobrança/);
    const b2Depois = await ler(b2.id);
    expect(n(b2Depois.paidTotal)).toBe(200);
    expect(b2Depois.status).toBe("PARTIAL");
  });
});

describe("parcial com dinheiro não sai do mês (achado 5)", () => {
  it("cancelBilling, cancelBillingsBulk e bulkRemoveClientsFromList recusam", async () => {
    const c = await createMrrClient(owner);
    const b = await createBilling(owner, c.id, { month: 8, year: 2035, amount: 1000 });
    await asOwner(owner, () => pay(b.id, 300, new Date(2035, 7, 5)));

    const r1 = await asOwner(owner, () => billings.cancelBilling(b.id, "teste"));
    expect(r1.ok).toBe(false);
    expect((r1 as any).error).toMatch(/estorne o pagamento/);

    const r2 = await asOwner(owner, () => billings.cancelBillingsBulk([b.id], "teste"));
    expect(r2.ok).toBe(false);
    expect((r2 as any).error).toMatch(/estorne o pagamento/);

    const r3 = await asOwner(owner, () =>
      inline.bulkRemoveClientsFromList([{ clientId: c.id, billingId: b.id }], 8, 2035, null)
    );
    expect(r3.ok).toBe(false);
    expect((await ler(b.id)).status).toBe("PARTIAL");
  });

  it("restaurar marcador com valor recebido volta PARTIAL (include e ensure)", async () => {
    const c = await createMrrClient(owner, { monthlyValue: 1000 });
    const b = await createBilling(owner, c.id, { month: 9, year: 2035, amount: 1000 });
    await asOwner(owner, () => pay(b.id, 400, new Date(2035, 8, 5)));
    // Estado legado: parcial cancelada antes da trava.
    await asOwner(owner, async () => prisma.billing.update({ where: { id: b.id }, data: { status: "CANCELED" } }));
    const inc = await asOwner(owner, () =>
      billings.includeClientInMonth(form({ competence: "2035-09", clientId: c.id }))
    );
    expect(inc.ok).toBe(true);
    expect((await ler(b.id)).status).toBe("PARTIAL");

    await asOwner(owner, async () => prisma.billing.update({ where: { id: b.id }, data: { status: "CANCELED" } }));
    const ens = await asOwner(owner, () => ciclo.ensureClientBillingForMonth(c.id, 9, 2035));
    expect(ens.ok).toBe(true);
    expect((await ler(b.id)).status).toBe("PARTIAL");
  });
});

describe("valor abaixo do recebido (achado 6)", () => {
  it("saveBilling recusa abaixo e quita quando igual", async () => {
    const c = await createMrrClient(owner);
    const b = await createBilling(owner, c.id, { month: 10, year: 2035, amount: 1000, revenueType: "ONE_TIME" });
    await asOwner(owner, () => pay(b.id, 600, new Date(2035, 9, 5)));
    const base = {
      id: b.id, clientId: c.id, description: "Avulsa", competence: "2035-10",
      dueDate: "10/10/2035", revenueType: "ONE_TIME",
    };
    const abaixo = await asOwner(owner, () => billings.saveBilling(form({ ...base, amount: "500,00" })));
    expect(abaixo.ok).toBe(false);
    const igual = await asOwner(owner, () => billings.saveBilling(form({ ...base, amount: "600,00" })));
    expect(igual.ok).toBe(true);
    const depois = await ler(b.id);
    expect(depois.status).toBe("PAID");
    expect(depois.paidAt).not.toBeNull();
  });

  it("edição inline do valor igual ao recebido quita a cobrança", async () => {
    const c = await createMrrClient(owner);
    const b = await createBilling(owner, c.id, { month: 11, year: 2035, amount: 1000 });
    await asOwner(owner, () => pay(b.id, 700, new Date(2035, 10, 5)));
    const r = await asOwner(owner, () => inline.setClientChargeAmount(c.id, "700,00", 11, 2035));
    expect(r.ok).toBe(true);
    expect((await ler(b.id)).status).toBe("PAID");
  });
});

describe("entrada espelho de pagamento (achado 8)", () => {
  it("saveIncome recusa editar espelho e id inexistente", async () => {
    const c = await createMrrClient(owner);
    const b = await createBilling(owner, c.id, { month: 12, year: 2035, amount: 100 });
    await asOwner(owner, () => pay(b.id, 100, new Date(2035, 11, 5)));
    const espelho = await asOwner(owner, async () =>
      prisma.income.findFirstOrThrow({ where: { billingId: b.id } })
    );
    const campos = { description: "x", amount: "1,00", receivedAt: "05/12/2035" };
    const r1 = await asOwner(owner, () => incomes.saveIncome(form({ ...campos, id: espelho.id })));
    expect(r1.ok).toBe(false);
    expect(n((await asOwner(owner, async () => prisma.income.findUniqueOrThrow({ where: { id: espelho.id } }))).amount)).toBe(100);
    const r2 = await asOwner(owner, () => incomes.saveIncome(form({ ...campos, id: "nao-existe" })));
    expect(r2.ok).toBe(false);
  });
});

describe("folha idempotente (achado 10)", () => {
  it("dois 'pagar folha' simultâneos criam UMA despesa", async () => {
    const emp = await asOwner(owner, async () =>
      prisma.employee.create({ data: { name: "Folha Dupla", type: "PJ", baseSalary: 1000 } })
    );
    const run = await asOwner(owner, async () =>
      prisma.payroll.create({ data: { month: 1, year: 2036, status: "APPROVED" } })
    );
    await asOwner(owner, async () =>
      prisma.payrollItem.create({ data: { payrollId: run.id, employeeId: emp.id, kind: "SALARY", amount: 1000 } })
    );
    const [a, b] = await asOwner(owner, () =>
      Promise.all([payroll.setPayrollStatus(run.id, "PAID"), payroll.setPayrollStatus(run.id, "PAID")])
    );
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const despesas = await asOwner(owner, async () =>
      prisma.transaction.count({ where: { expenseType: "PAYROLL", description: { contains: "01/2036" } } })
    );
    expect(despesas).toBe(1);
  });

  it("dois 'pagar complemento' simultâneos criam UMA despesa", async () => {
    const emp = await asOwner(owner, async () =>
      prisma.employee.create({ data: { name: "Complemento Duplo", type: "PJ", baseSalary: 1000 } })
    );
    const run = await asOwner(owner, async () =>
      prisma.payroll.create({ data: { month: 2, year: 2036, status: "PAID", paidAt: new Date(2036, 1, 5) } })
    );
    await asOwner(owner, async () =>
      prisma.payrollItem.create({ data: { payrollId: run.id, employeeId: emp.id, kind: "COMMISSION", amount: 300 } })
    );
    const [a, b] = await asOwner(owner, () =>
      Promise.all([
        complemento.pagarComplementoDaFolha(run.id),
        complemento.pagarComplementoDaFolha(run.id),
      ])
    );
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const despesas = await asOwner(owner, async () =>
      prisma.transaction.count({ where: { expenseType: "PAYROLL", description: { contains: "02/2036" } } })
    );
    expect(despesas).toBe(1);
  });
});

describe("nome do responsável comercial (achado 11)", () => {
  it("renomear propaga; excluir limpa o texto", async () => {
    const emp = await asOwner(owner, async () =>
      prisma.employee.create({ data: { name: "Vendedor Antigo", type: "PJ", baseSalary: 0 } })
    );
    const c = await createMrrClient(owner);
    await asOwner(owner, async () =>
      prisma.client.update({ where: { id: c.id }, data: { salesOwnerId: emp.id, salesOwner: "Vendedor Antigo" } })
    );
    const r = await asOwner(owner, () =>
      payroll.saveEmployee(form({ id: emp.id, name: "Vendedor Novo", type: "PJ", baseSalary: "0" }))
    );
    expect(r.ok).toBe(true);
    const lido = () =>
      asOwner(owner, async () => prisma.client.findUniqueOrThrow({ where: { id: c.id }, select: { salesOwner: true, salesOwnerId: true } }));
    expect((await lido()).salesOwner).toBe("Vendedor Novo");

    const d = await asOwner(owner, () => payroll.deleteEmployee(emp.id));
    expect(d.ok).toBe(true);
    expect(await lido()).toEqual({ salesOwner: null, salesOwnerId: null });
  });
});
