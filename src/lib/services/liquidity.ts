import { prisma } from "@/lib/prisma";
import { ownerCached } from "@/lib/owner-cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { toNumber as n } from "@/lib/format";

/**
 * LIQUIDEZ DISPONÍVEL (F1.19 · ref. 02 §5.1 — sexto card do painel).
 *
 * "Liquidez disponível + projeção 30d."
 *
 * DECIDIDO 19.34 (31/08), e é o que esta métrica passou a fazer: a restrição
 * é POR RESERVA, e impostos e 13º nascem restritos.
 *
 * RESERVA RESTRITA NÃO ENTRA NA LIQUIDEZ. Aquele dinheiro tem dono e tem
 * data: mostrá-lo como disponível é exatamente o que faz alguém aprovar uma
 * despesa contra o imposto do mês seguinte, e descobrir no dia do vencimento.
 * O card mostra o disponível; a composição continua mostrando tudo, com as
 * restritas marcadas, para a conta continuar aberta.
 *
 * A projeção de 30 dias é igualmente conservadora e explícita:
 *   entradas = cobranças em aberto que vencem nos próximos 30 dias
 *   saídas   = despesas não pagas com vencimento nos próximos 30 dias
 * É previsão de CAIXA, não de competência.
 */

export type Liquidez = {
  contas: number;
  reservas: number;
  /** Parte das reservas que é RESTRITA e sai do disponível (19.34). */
  reservado: number;
  disponivel: number;
  /** Composição para o detalhe do card — mostra tudo, marcando as restritas. */
  itens: {
    label: string;
    value: number;
    tipo: "conta" | "reserva";
    restrita: boolean;
  }[];
  entradas30d: number;
  saidas30d: number;
  projecao30d: number;
};

async function getLiquidezImpl(hojeISO: string): Promise<Liquidez> {
  const hoje = new Date(hojeISO);
  const em30 = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [contas, reservas, aReceber, aPagar] = await Promise.all([
    prisma.account.findMany({ select: { name: true, balance: true } }),
    prisma.cashBox.findMany({
      select: { name: true, currentAmount: true, restricted: true },
    }),
    prisma.billing.findMany({
      where: {
        status: { notIn: ["PAID", "CANCELED"] },
        dueDate: { gte: hoje, lt: em30 },
      },
      select: { amount: true, paidTotal: true },
    }),
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { in: ["pendente", "devendo"] },
        dueDate: { gte: hoje, lt: em30 },
      },
      select: { amount: true },
    }),
  ]);

  const somaContas = contas.reduce((s, c) => s + n(c.balance), 0);
  const somaReservas = reservas.reduce((s, r) => s + n(r.currentAmount), 0);
  const somaRestritas = reservas
    .filter((r) => r.restricted)
    .reduce((s, r) => s + n(r.currentAmount), 0);
  const entradas30d = aReceber.reduce(
    (s, b) => s + Math.max(0, n(b.amount) - n(b.paidTotal)),
    0
  );
  const saidas30d = aPagar.reduce((s, t) => s + n(t.amount), 0);
  // 01 §7.2: "Liquidez disponível = total - reservado". O card principal usa
  // esta, nunca o saldo bruto.
  const disponivel = somaContas + somaReservas - somaRestritas;

  return {
    contas: somaContas,
    reservas: somaReservas,
    reservado: somaRestritas,
    disponivel,
    itens: [
      ...contas.map((c) => ({
        label: c.name, value: n(c.balance), tipo: "conta" as const, restrita: false,
      })),
      ...reservas.map((r) => ({
        label: r.name,
        value: n(r.currentAmount),
        tipo: "reserva" as const,
        restrita: r.restricted,
      })),
    ],
    entradas30d,
    saidas30d,
    projecao30d: disponivel + entradas30d - saidas30d,
  };
}

export const getLiquidez = ownerCached("liquidez", getLiquidezImpl, {
  revalidate: 300,
  tags: [CACHE_TAGS.DASHBOARD_METRICS],
});
