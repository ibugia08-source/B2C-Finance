import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";
import { getLiquidez, type Liquidez } from "@/lib/services/liquidity";

/**
 * FLUXO DE CAIXA E PROJEÇÃO 30/60/90 (F3.11 · ref. 01 §7.2; 02 §4.4).
 *
 * "Projeção 30/60/90 = liquidez esperada por recebimentos e pagamentos
 * projetados."
 *
 * É PREVISÃO DE CAIXA, não de competência: a data que manda é o VENCIMENTO,
 * não a competência da cobrança nem a do custo. Uma projeção montada por
 * competência mostra dinheiro que ainda não entrou como se estivesse na
 * conta — e é assim que se aprova uma despesa contra um recebimento que vai
 * cair no mês que vem.
 *
 * O LIMITE DESTA PROJEÇÃO, declarado porque quem lê precisa saber: ela conta
 * o que JÁ EXISTE — cobrança emitida e despesa lançada. Não projeta a
 * mensalidade de novembro que ainda não foi gerada, nem o aluguel recorrente
 * do mês que vem. Então a projeção de 90 dias é sistematicamente OTIMISTA nas
 * saídas e PESSIMISTA nas entradas, e a tela diz isso em vez de deixar a
 * pessoa descobrir sozinha.
 *
 * POR CONTA, a honestidade é a mesma: só as SAÍDAS têm conta endereçada
 * (`Transaction.accountId`). Recebimento não tem — cobrança não escolhe conta
 * antes de o dinheiro cair. Distribuir as entradas entre as contas por
 * proporção de saldo seria inventar um número; então elas ficam no
 * consolidado, e a tabela por conta diz o que mostra.
 */

export const HORIZONTES = [30, 60, 90] as const;
export type Horizonte = (typeof HORIZONTES)[number];

export type ProjecaoDoHorizonte = {
  dias: Horizonte;
  entradas: number;
  saidas: number;
  /** Disponível de hoje + entradas − saídas até o horizonte. */
  liquidezProjetada: number;
  negativa: boolean;
};

export type ContaNoFluxo = {
  accountId: string | null;
  nome: string;
  saldoAtual: number;
  /** Saídas já endereçadas a esta conta, por horizonte. */
  saidas: Record<Horizonte, number>;
  /** Saldo da conta menos as saídas endereçadas até o horizonte. */
  saldoProjetado: Record<Horizonte, number>;
};

export type FluxoDeCaixa = {
  hoje: Date;
  liquidez: Liquidez;
  projecoes: ProjecaoDoHorizonte[];
  contas: ContaNoFluxo[];
  /** Primeiro horizonte em que a liquidez projetada fica negativa. */
  primeiroNegativo: Horizonte | null;
  aviso: string;
};

export const AVISO_DA_PROJECAO =
  "A projeção conta só o que já existe: cobrança emitida e despesa lançada. Mensalidade ainda não gerada e despesa recorrente do mês que vem não entram.";

export async function fluxoDeCaixa(hoje: Date = new Date()): Promise<FluxoDeCaixa> {
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const limite = new Date(base.getTime() + 90 * 86_400_000);

  const [liquidez, contas, aReceber, aPagar] = await Promise.all([
    getLiquidez(base.toISOString()),
    prisma.account.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, balance: true },
    }),
    prisma.billing.findMany({
      where: {
        status: { notIn: ["PAID", "CANCELED"] },
        dueDate: { gte: base, lt: limite },
      },
      select: { amount: true, paidTotal: true, dueDate: true },
    }),
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { in: ["pendente", "devendo"] },
        OR: [
          { dueDate: { gte: base, lt: limite } },
          { dueDate: null, date: { gte: base, lt: limite } },
        ],
      },
      select: { amount: true, dueDate: true, date: true, accountId: true },
    }),
  ]);

  // Cobrança VENCIDA e ainda aberta não entra: ela já deveria ter entrado, e
  // contá-la como entrada dos próximos 30 dias é a maneira mais comum de uma
  // projeção de caixa mentir para cima.
  const dentro = (d: Date, dias: Horizonte) =>
    d.getTime() < base.getTime() + dias * 86_400_000;

  const projecoes: ProjecaoDoHorizonte[] = HORIZONTES.map((dias) => {
    const entradas = aReceber
      .filter((b) => dentro(b.dueDate, dias))
      .reduce((s, b) => s + Math.max(0, n(b.amount) - n(b.paidTotal)), 0);
    const saidas = aPagar
      .filter((t) => dentro(t.dueDate ?? t.date, dias))
      .reduce((s, t) => s + n(t.amount), 0);
    const liquidezProjetada =
      Math.round((liquidez.disponivel + entradas - saidas) * 100) / 100;
    return {
      dias,
      entradas: Math.round(entradas * 100) / 100,
      saidas: Math.round(saidas * 100) / 100,
      liquidezProjetada,
      negativa: liquidezProjetada < 0,
    };
  });

  const semConta = aPagar.filter((t) => !t.accountId);
  const linhas: ContaNoFluxo[] = contas.map((c) => {
    const minhas = aPagar.filter((t) => t.accountId === c.id);
    const saidas = Object.fromEntries(
      HORIZONTES.map((d) => [
        d,
        Math.round(
          minhas.filter((t) => dentro(t.dueDate ?? t.date, d)).reduce((s, t) => s + n(t.amount), 0) * 100
        ) / 100,
      ])
    ) as Record<Horizonte, number>;
    const saldo = n(c.balance);
    return {
      accountId: c.id,
      nome: c.name,
      saldoAtual: saldo,
      saidas,
      saldoProjetado: Object.fromEntries(
        HORIZONTES.map((d) => [d, Math.round((saldo - saidas[d]) * 100) / 100])
      ) as Record<Horizonte, number>,
    };
  });

  if (semConta.length > 0) {
    const saidas = Object.fromEntries(
      HORIZONTES.map((d) => [
        d,
        Math.round(
          semConta.filter((t) => dentro(t.dueDate ?? t.date, d)).reduce((s, t) => s + n(t.amount), 0) * 100
        ) / 100,
      ])
    ) as Record<Horizonte, number>;
    linhas.push({
      accountId: null,
      nome: "Sem conta definida",
      saldoAtual: 0,
      saidas,
      saldoProjetado: Object.fromEntries(
        HORIZONTES.map((d) => [d, -saidas[d]])
      ) as Record<Horizonte, number>,
    });
  }

  return {
    hoje: base,
    liquidez,
    projecoes,
    contas: linhas,
    primeiroNegativo: projecoes.find((p) => p.negativa)?.dias ?? null,
    aviso: AVISO_DA_PROJECAO,
  };
}
