import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner, createBilling, createMrrClient, createOwner, destroyOwner,
  prisma, type TestOwner,
} from "./support/db";
import {
  DIA_DO_PAGAMENTO_DA_FOLHA, fluxoProjetado,
} from "@/lib/services/cash-flow";

/**
 * F3.11 (v2) — fluxo de caixa PROJETADO DIA A DIA (01 §7.2; 02 §4.4).
 *
 * O erro que estes testes evitam é o mais caro de uma projeção de caixa:
 * mentir para cima. Competência no lugar de vencimento, cobrança contada
 * pelo valor cheio quando já recebeu metade, gasto de cartão contado duas
 * vezes (na compra e na fatura), folha aprovada que não aparece — todos
 * fazem a tela mostrar dinheiro que não existe, e é contra ela que alguém
 * decide adiar ou não um pagamento.
 *
 * A fixture cobre de propósito os quatro tipos do período: entrada, saída,
 * recorrência já materializada e fatura de cartão.
 */

const DIA = 86_400_000;
/** Meia-noite UTC de hoje — as datas do banco são ancoradas em UTC. */
function hojeUTC(): Date {
  const a = new Date();
  return new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
}
const dia = (d: Date) => d.toISOString().slice(0, 10);

describe("F3.11 — projeção diária de caixa", () => {
  let dono: TestOwner;
  let cliente: { id: string; name: string };
  let contaId: string;
  let outraContaId: string;
  const HOJE = hojeUTC();
  const em = (d: number) => new Date(HOJE.getTime() + d * DIA);

  beforeAll(async () => {
    dono = await createOwner();
    cliente = await createMrrClient(dono, { name: "Cliente do fluxo" });
    await asOwner(dono, async () => {
      contaId = (
        await prisma.account.create({
          data: { name: "Conta do fluxo", type: "corrente", balance: 5000 },
          select: { id: true },
        })
      ).id;
      outraContaId = (
        await prisma.account.create({
          data: { name: "Conta secundária", type: "corrente", balance: 1000 },
          select: { id: true },
        })
      ).id;
      // Conta INATIVA não entra no saldo de partida.
      await prisma.account.create({
        data: { name: "Conta encerrada", type: "corrente", balance: 9999, active: false },
      });

      // ENTRADA: cobrança de 1.000 com 200 já recebidos → entra 800.
      const cob = await createBilling(dono, cliente.id, {
        month: HOJE.getUTCMonth() + 1, year: HOJE.getUTCFullYear(), amount: 1000,
      });
      await prisma.billing.update({
        where: { id: cob.id },
        data: { dueDate: em(3), paidTotal: 200, status: "PARTIAL" },
      });

      // ENTRADA ATRASADA que cai dentro da janela escolhida.
      // Competência anterior (a unique é por cliente×competência) com
      // vencimento dentro da janela: é exatamente o caso da vencida velha.
      const anterior = new Date(Date.UTC(HOJE.getUTCFullYear(), HOJE.getUTCMonth() - 1, 1));
      const vencida = await createBilling(dono, cliente.id, {
        month: anterior.getUTCMonth() + 1, year: anterior.getUTCFullYear(), amount: 500,
        description: "Cobrança vencida",
      });
      await prisma.billing.update({
        where: { id: vencida.id },
        data: { dueDate: em(-2), status: "OVERDUE" },
      });

      // SAÍDA simples e RECORRÊNCIA já materializada (é despesa como as outras).
      await prisma.transaction.createMany({
        data: [
          { date: em(5), dueDate: em(5), description: "Aluguel", amount: 300,
            type: "despesa", status: "pendente", accountId: contaId },
          { date: em(10), dueDate: em(10), description: "Assinatura mensal (recorrência)",
            amount: 150, type: "despesa", status: "pendente", accountId: contaId },
          { date: em(6), dueDate: em(6), description: "Conta paga", amount: 999,
            type: "despesa", status: "pago", accountId: contaId },
        ],
      });

      // CARTÃO: a fatura entra; a compra dentro dela NÃO (contagem dupla).
      const cartao = await prisma.creditCard.create({
        data: {
          name: "Cartão da empresa", limitTotal: 10000, closingDay: 1, dueDay: 8,
          accountId: contaId,
        },
        select: { id: true },
      });
      const fatura = await prisma.creditCardInvoice.create({
        data: {
          cardId: cartao.id, referenceMonth: HOJE.getUTCMonth() + 1,
          referenceYear: HOJE.getUTCFullYear(), closingDate: em(1), dueDate: em(8),
          total: 700, paid: 100, status: "fechada",
        },
        select: { id: true },
      });
      await prisma.transaction.create({
        data: {
          date: em(8), dueDate: em(8), description: "Compra no cartão", amount: 700,
          type: "despesa", status: "pendente", cardId: cartao.id, invoiceId: fatura.id,
        },
      });
    });
  });

  afterAll(async () => {
    await destroyOwner(dono);
  });

  it("o saldo de partida é o das contas ATIVAS e a série tem um dia por dia", async () => {
    const f = await asOwner(dono, async () =>
      fluxoProjetado({ de: em(-5), ate: em(24) })
    );
    expect(f.saldoInicial).toBe(6000); // 5000 + 1000; a encerrada fica fora
    expect(f.dias).toHaveLength(30);
    expect(f.dias[0].dia).toBe(dia(em(-5)));
    expect(f.dias[29].dia).toBe(dia(em(24)));
  });

  it("cobrança entra pelo SALDO, não pelo valor cheio", async () => {
    const f = await asOwner(dono, async () => fluxoProjetado({ de: em(0), ate: em(24) }));
    const d = f.dias.find((x) => x.dia === dia(em(3)))!;
    expect(d.entradas).toBe(800);
    expect(d.lancamentos[0].tipo).toBe("COBRANCA");
  });

  it("vencida que cai na janela vem MARCADA como atrasada", async () => {
    const f = await asOwner(dono, async () => fluxoProjetado({ de: em(-5), ate: em(24) }));
    const d = f.dias.find((x) => x.dia === dia(em(-2)))!;
    expect(d.entradas).toBe(500);
    expect(d.lancamentos[0].atrasada).toBe(true);
    // E a mesma cobrança NÃO aparece quando a janela começa hoje.
    const so = await asOwner(dono, async () => fluxoProjetado({ de: em(0), ate: em(24) }));
    expect(so.dias.every((x) => x.lancamentos.every((l) => !l.atrasada))).toBe(true);
  });

  it("gasto de cartão conta UMA vez: a fatura entra, a compra dela não", async () => {
    const f = await asOwner(dono, async () => fluxoProjetado({ de: em(0), ate: em(24) }));
    const d = f.dias.find((x) => x.dia === dia(em(8)))!;
    // 600 = 700 da fatura − 100 já pago. Se a compra entrasse junto, seria 1.300.
    expect(d.saidas).toBe(600);
    expect(d.lancamentos.map((l) => l.tipo)).toEqual(["FATURA"]);
  });

  it("despesa PAGA não é projeção, e a recorrência materializada é", async () => {
    const f = await asOwner(dono, async () => fluxoProjetado({ de: em(0), ate: em(24) }));
    expect(f.dias.find((x) => x.dia === dia(em(6)))!.saidas).toBe(0);
    expect(f.dias.find((x) => x.dia === dia(em(10)))!.saidas).toBe(150);
  });

  it("o saldo acumula dia a dia e fecha no total do período", async () => {
    const f = await asOwner(dono, async () => fluxoProjetado({ de: em(0), ate: em(24) }));
    expect(f.totalEntradas).toBe(800);
    expect(f.totalSaidas).toBe(1050); // 300 + 150 + 600
    expect(f.saldoFinal).toBe(f.saldoInicial + 800 - 1050);
    // Monótono na conta: cada dia é o anterior mais o líquido do dia.
    let acc = f.saldoInicial;
    for (const d of f.dias) {
      acc = Math.round((acc + d.entradas - d.saidas) * 100) / 100;
      expect(d.saldoAcumulado).toBe(acc);
    }
  });

  it("o horizonte é do usuário: 7 dias enxergam só o que vence em 7 dias", async () => {
    const curto = await asOwner(dono, async () => fluxoProjetado({ de: em(0), ate: em(6) }));
    expect(curto.dias).toHaveLength(7);
    // Só o aluguel do dia 5. A fatura (dia 8) e a assinatura (dia 10) ficam
    // de fora — mudar o chip muda o número, que é o ponto do filtro.
    expect(curto.totalSaidas).toBe(300);
    const trintaDias = await asOwner(dono, async () => fluxoProjetado({ de: em(0), ate: em(29) }));
    expect(trintaDias.totalSaidas).toBe(1050);
  });

  it("o filtro por conta aperta o saldo inicial e as saídas endereçadas", async () => {
    const f = await asOwner(dono, async () =>
      fluxoProjetado({ de: em(0), ate: em(24), accountId: outraContaId })
    );
    expect(f.saldoInicial).toBe(1000);
    // Nada é endereçado à conta secundária: só as entradas, que não escolhem
    // conta, continuam aparecendo no consolidado.
    expect(f.totalSaidas).toBe(0);
    expect(f.totalEntradas).toBe(800);
  });

  it("avisa o primeiro dia em que o saldo cruza o zero", async () => {
    await asOwner(dono, async () => {
      await prisma.transaction.create({
        data: {
          date: em(12), dueDate: em(12), description: "Rescisão", amount: 20_000,
          type: "despesa", status: "pendente", accountId: contaId,
        },
      });
    });
    const f = await asOwner(dono, async () => fluxoProjetado({ de: em(0), ate: em(24) }));
    expect(f.primeiroDiaNegativo?.dia).toBe(dia(em(12)));
    expect(f.primeiroDiaNegativo!.saldo).toBeLessThan(0);
    await asOwner(dono, async () => {
      await prisma.transaction.deleteMany({ where: { description: "Rescisão" } });
    });
  });

  it("folha APROVADA entra na data de convenção, marcada como estimada", async () => {
    const competencia = { year: HOJE.getUTCFullYear(), month: HOJE.getUTCMonth() + 1 };
    const pagamento = new Date(
      Date.UTC(competencia.year, competencia.month, DIA_DO_PAGAMENTO_DA_FOLHA)
    );
    await asOwner(dono, async () => {
      const emp = await prisma.employee.create({
        data: { name: "Colaborador do fluxo", role: "Gestor" },
        select: { id: true },
      });
      const folha = await prisma.payroll.create({
        data: { month: competencia.month, year: competencia.year, status: "APPROVED" },
        select: { id: true },
      });
      await prisma.payrollItem.create({
        data: { payrollId: folha.id, employeeId: emp.id, kind: "SALARY", amount: 4000 },
      });
    });

    // Janela de 60 dias: o dia 5 do mês seguinte cabe sempre.
    const f = await asOwner(dono, async () => fluxoProjetado({ de: em(0), ate: em(60) }));
    const d = f.dias.find((x) => x.dia === dia(pagamento))!;
    const folhaNoDia = d.lancamentos.find((l) => l.tipo === "FOLHA")!;
    expect(folhaNoDia.valor).toBe(-4000);
    expect(folhaNoDia.estimada).toBe(true);

    // Rascunho NÃO entra: rascunho não é compromisso.
    await asOwner(dono, async () => {
      await prisma.payroll.updateMany({
        where: { month: competencia.month, year: competencia.year },
        data: { status: "DRAFT" },
      });
    });
    const semFolha = await asOwner(dono, async () => fluxoProjetado({ de: em(0), ate: em(60) }));
    expect(
      semFolha.dias.every((x) => x.lancamentos.every((l) => l.tipo !== "FOLHA"))
    ).toBe(true);

    await asOwner(dono, async () => {
      await prisma.payrollItem.deleteMany({});
      await prisma.payroll.deleteMany({});
    });
  });
});
