import { prisma } from "@/lib/prisma";
import { ownerCached } from "@/lib/owner-cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { toNumber as n } from "@/lib/format";

/**
 * LIQUIDEZ DISPONÍVEL (F1.19 · ref. 02 §5.1 — sexto card do painel).
 *
 * "Liquidez disponível + projeção 30d."
 *
 * ATENÇÃO AO ESCOPO: a versão COMPLETA desta métrica é da F3.11, que
 * depende da DECISÃO 19.34 (quais reservas contam como restritas e
 * portanto saem da liquidez). Enquanto 19.34 estiver aberta, este
 * serviço soma contas + reservas SEM excluir nenhuma, e devolve a
 * composição para a interface DIZER exatamente o que entrou. Não
 * inventamos regra de restrição: mostramos a conta aberta.
 *
 * A projeção de 30 dias é igualmente conservadora e explícita:
 *   entradas = cobranças em aberto que vencem nos próximos 30 dias
 *   saídas   = despesas não pagas com vencimento nos próximos 30 dias
 * É previsão de CAIXA, não de competência.
 */

export type Liquidez = {
  contas: number;
  reservas: number;
  disponivel: number;
  /** Composição para o detalhe do card. */
  itens: { label: string; value: number; tipo: "conta" | "reserva" }[];
  entradas30d: number;
  saidas30d: number;
  projecao30d: number;
};

async function getLiquidezImpl(hojeISO: string): Promise<Liquidez> {
  const hoje = new Date(hojeISO);
  const em30 = new Date(hoje.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [contas, reservas, aReceber, aPagar] = await Promise.all([
    prisma.account.findMany({ select: { name: true, balance: true } }),
    prisma.cashBox.findMany({ select: { name: true, currentAmount: true } }),
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
  const entradas30d = aReceber.reduce(
    (s, b) => s + Math.max(0, n(b.amount) - n(b.paidTotal)),
    0
  );
  const saidas30d = aPagar.reduce((s, t) => s + n(t.amount), 0);
  const disponivel = somaContas + somaReservas;

  return {
    contas: somaContas,
    reservas: somaReservas,
    disponivel,
    itens: [
      ...contas.map((c) => ({ label: c.name, value: n(c.balance), tipo: "conta" as const })),
      ...reservas.map((r) => ({ label: r.name, value: n(r.currentAmount), tipo: "reserva" as const })),
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
