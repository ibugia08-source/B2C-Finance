import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createOwner, destroyOwner,
  prisma, runWithoutScope, type TestOwner,
} from "./support/db";
import {
  pagarComplementoDaFolha,
  podeRemoverItem,
  incorporarComissoesPendentes,
} from "@/lib/services/payroll-complement";
import { getPayrollSummary } from "@/lib/services/finance-metrics";

/**
 * COMPLEMENTO DA FOLHA — o fluxo real do dono: a folha (salários) é paga no
 * início do mês; a comissão da competência só fecha no MÊS SEGUINTE.
 *
 * As regras que importam:
 *  1. lançamento numa folha PAGA entra como A PAGAR — a despesa original
 *     nunca muda de valor (dinheiro pago não é reescrito);
 *  2. comissão pendente entra na folha paga do mesmo jeito (a pagar);
 *  3. "pagar complemento" cria uma NOVA despesa na data do pagamento e
 *     carimba os itens cobertos;
 *  4. item coberto por pagamento não pode ser removido; item a pagar pode.
 *
 * Competência 2032-03: exclusiva desta suíte.
 */

const MES = 3;
const ANO = 2032;

let dono: TestOwner;
let empId = "";
let runId = "";
let paidAt: Date;

beforeAll(async () => {
  dono = await createOwner();
  paidAt = new Date(ANO, MES - 1, 5);
  await asOwner(dono, async () => {
    const emp = await prisma.employee.create({
      data: { name: "Colaborador Complemento", type: "PJ", baseSalary: 1000, active: true },
    });
    empId = emp.id;
    const run = await prisma.payroll.create({
      data: { month: MES, year: ANO, status: "PAID", paidAt },
    });
    runId = run.id;
    // Estado pós-pagamento original: salário coberto pela despesa da folha.
    await prisma.payrollItem.create({
      data: { payrollId: run.id, employeeId: emp.id, kind: "SALARY", amount: 1000, settledAt: paidAt },
    });
    await prisma.transaction.create({
      data: {
        date: paidAt,
        description: `Folha de pagamento 03/${ANO}`,
        amount: 1000,
        type: "despesa", origin: "pix", status: "pago",
        belongsTo: "empresa", expenseType: "PAYROLL", hash: null,
      },
    });
  });
});

afterAll(async () => {
  await runWithoutScope(async () => {
    await prisma.payrollItem.deleteMany({ where: { payrollId: runId } });
    await prisma.payroll.deleteMany({ where: { id: runId } });
    await prisma.commission.deleteMany({ where: { year: ANO } });
    await prisma.transaction.deleteMany({
      where: { expenseType: "PAYROLL", description: { contains: `03/${ANO}` } },
    });
    await prisma.employee.deleteMany({ where: { id: empId } });
  });
  await destroyOwner(dono);
});

describe("folha — lançamentos após o pagamento", () => {
  it("lançamento em folha paga entra como complemento A PAGAR", async () => {
    await asOwner(dono, async () => {
      await prisma.payrollItem.create({
        data: { payrollId: runId, employeeId: empId, kind: "BONUS", amount: 500, notes: "Bônus de meta" },
      });
      const s = await getPayrollSummary(MES, ANO);
      expect(s.total).toBe(1500);
      expect(s.pendingTotal).toBe(500);
    });
  });

  it("comissão pendente entra na folha PAGA como a pagar (e vira APPROVED)", async () => {
    await asOwner(dono, async () => {
      await prisma.commission.create({
        data: { employeeId: empId, amount: 250, month: MES, year: ANO, status: "PENDING" },
      });
      const trazidas = await incorporarComissoesPendentes({ id: runId, month: MES, year: ANO });
      expect(trazidas).toBe(1);

      const comissao = await prisma.commission.findFirst({ where: { month: MES, year: ANO } });
      expect(comissao?.status).toBe("APPROVED");

      const s = await getPayrollSummary(MES, ANO);
      expect(s.pendingTotal).toBe(750); // bônus 500 + comissão 250
    });
  });

  it("pagar complemento cria NOVA despesa, carimba itens e não mexe na original", async () => {
    await asOwner(dono, async () => {
      const r = await pagarComplementoDaFolha(runId);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.total).toBe(750);
      expect(r.itens).toBe(2);

      const complemento = await prisma.transaction.findUnique({ where: { id: r.transactionId } });
      expect(Number(complemento?.amount)).toBe(750);
      expect(complemento?.description).toContain("Complemento da folha 03/");

      // A despesa ORIGINAL da folha continua com o valor pago na época.
      const original = await prisma.transaction.findFirst({
        where: { description: `Folha de pagamento 03/${ANO}` },
      });
      expect(Number(original?.amount)).toBe(1000);

      // Tudo coberto; comissão quitada junto.
      const s = await getPayrollSummary(MES, ANO);
      expect(s.pendingTotal).toBe(0);
      const comissao = await prisma.commission.findFirst({ where: { month: MES, year: ANO } });
      expect(comissao?.status).toBe("PAID");

      // Sem nada a pagar, o segundo clique explica em vez de pagar de novo.
      const denovo = await pagarComplementoDaFolha(runId);
      expect(denovo.ok).toBe(false);
      if (!denovo.ok) expect(denovo.error).toContain("Nenhum lançamento");
    });
  });

  it("item coberto por pagamento não sai; item a pagar sai", () => {
    expect(podeRemoverItem("PAID", { settledAt: new Date() }).ok).toBe(false);
    expect(podeRemoverItem("PAID", { settledAt: null }).ok).toBe(true);
    expect(podeRemoverItem("DRAFT", { settledAt: null }).ok).toBe(true);
  });

  it("complemento só de descontos não gera pagamento", async () => {
    await asOwner(dono, async () => {
      const desconto = await prisma.payrollItem.create({
        data: { payrollId: runId, employeeId: empId, kind: "DEDUCTION", amount: 100 },
      });
      const r = await pagarComplementoDaFolha(runId);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("positivo");
      await prisma.payrollItem.delete({ where: { id: desconto.id } });
    });
  });
});
