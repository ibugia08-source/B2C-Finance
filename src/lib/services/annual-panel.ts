import { prisma } from "@/lib/prisma";
import { ownerCached } from "@/lib/owner-cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { toNumber as n } from "@/lib/format";
import { getYearlySeries } from "@/lib/services/dashboard-main";

/**
 * PAINEL ANUAL — a planilha 2 do dono (indicador × JAN..DEZ + acumulado).
 * Séries centrais (esperado/recebido/despesas/resultado) vêm de
 * getYearlySeries (fonte oficial do Dashboard — mesmos números); este
 * serviço agrega o restante por mês em queries agrupadas, sem criar
 * nova definição de faturamento.
 */

export type AnnualPanel = {
  year: number;
  /** Índice do último mês com dados (0-11); -1 = ano todo no futuro. */
  lastMonthWithData: number;
  esperado: number[];
  recebido: number[];
  novosClientesValor: number[];
  novosClientesQtde: number[];
  outrasEntradas: number[];
  despesas: number[];
  folha: number[];
  trafego: number[];
  comissao: number[];
  resultado: number[];
  clientesAtivos: number[];
  churnQtde: number[];
  churnValor: number[];
};

async function getAnnualPanelImpl(year: number): Promise<AnnualPanel> {
  const yStart = new Date(year, 0, 1);
  const yEnd = new Date(year + 1, 0, 1);
  const zero = () => Array(12).fill(0) as number[];

  // FASE 1 — séries oficiais (cacheadas por conta própria).
  const series = await getYearlySeries(year);

  // FASE 2 — agregações complementares (≤5 em paralelo).
  const [newClients, losses, payrolls, adsExpenses, commissions] = await Promise.all([
    prisma.client.findMany({
      where: {
        OR: [
          { startedAt: { gte: yStart, lt: yEnd } },
          { startedAt: null, createdAt: { gte: yStart, lt: yEnd } },
        ],
      },
      select: {
        startedAt: true,
        createdAt: true,
        modality: true,
        monthlyValue: true,
        totalContractValue: true,
      },
    }),
    prisma.clientLoss.findMany({
      where: { lostAt: { gte: yStart, lt: yEnd } },
      select: { lostAt: true, referenceValue: true, monthlyValue: true },
    }),
    prisma.payroll.findMany({
      where: { year },
      select: {
        month: true,
        items: { select: { kind: true, amount: true } },
      },
    }),
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { not: "cancelado" },
        expenseType: "ADS",
        date: { gte: yStart, lt: yEnd },
      },
      select: { amount: true, date: true },
    }),
    prisma.commission.findMany({
      where: { year, status: { not: "CANCELED" } },
      select: { month: true, amount: true },
    }),
  ]);

  // FASE 3 — entradas avulsas/recuperações e clientes no ciclo por mês.
  const [looseIncomes, manualExtras, cycleBillings] = await Promise.all([
    prisma.income.findMany({
      where: {
        status: "RECEIVED",
        receivedAt: { gte: yStart, lt: yEnd },
        OR: [{ billingId: null }, { revenueType: "RECOVERY" }],
      },
      select: { amount: true, receivedAt: true },
    }),
    prisma.extraRevenue.findMany({
      // Pela COMPETÊNCIA informada no cadastro; legado cai no recebimento.
      where: {
        origin: "MANUAL",
        OR: [
          { competenceYear: year },
          { competenceYear: null, receivedAt: { gte: yStart, lt: yEnd } },
        ],
      },
      select: { amount: true, receivedAt: true, competenceMonth: true },
    }),
    prisma.billing.findMany({
      where: { competenceYear: year, status: { not: "CANCELED" } },
      distinct: ["clientId", "competenceMonth"],
      select: { clientId: true, competenceMonth: true },
    }),
  ]);

  const novosClientesValor = zero();
  const novosClientesQtde = zero();
  for (const c of newClients) {
    const d = c.startedAt ?? c.createdAt;
    if (!d || d < yStart || d >= yEnd) continue;
    const m = d.getMonth();
    novosClientesQtde[m] += 1;
    novosClientesValor[m] +=
      c.modality === "TCV" ? n(c.totalContractValue) : n(c.monthlyValue);
  }

  const churnQtde = zero();
  const churnValor = zero();
  for (const l of losses) {
    const m = l.lostAt.getMonth();
    churnQtde[m] += 1;
    churnValor[m] += n(l.referenceValue ?? l.monthlyValue);
  }

  const folha = zero();
  for (const run of payrolls) {
    const total = run.items.reduce(
      (s, i) => s + n(i.amount) * (i.kind === "DEDUCTION" ? -1 : 1),
      0
    );
    if (run.month >= 1 && run.month <= 12) folha[run.month - 1] += total;
  }

  const trafego = zero();
  for (const t of adsExpenses) trafego[t.date.getMonth()] += n(t.amount);

  const comissao = zero();
  for (const c of commissions)
    if (c.month >= 1 && c.month <= 12) comissao[c.month - 1] += n(c.amount);

  const outrasEntradas = zero();
  for (const i of looseIncomes) outrasEntradas[i.receivedAt.getMonth()] += n(i.amount);
  for (const e of manualExtras)
    outrasEntradas[(e.competenceMonth ?? e.receivedAt.getMonth() + 1) - 1] +=
      n(e.amount);

  const clientesAtivos = zero();
  for (const b of cycleBillings)
    if (b.competenceMonth >= 1 && b.competenceMonth <= 12)
      clientesAtivos[b.competenceMonth - 1] += 1;

  const now = new Date();
  const lastMonthWithData =
    year < now.getFullYear() ? 11 : year > now.getFullYear() ? -1 : now.getMonth();

  return {
    year,
    lastMonthWithData,
    esperado: series.faturamento,
    recebido: series.recebido,
    novosClientesValor,
    novosClientesQtde,
    outrasEntradas,
    despesas: series.despesas,
    folha,
    trafego,
    comissao,
    resultado: series.resultado,
    clientesAtivos,
    churnQtde,
    churnValor,
  };
}

/** Cacheado por (usuário, ano) — TTL 300s, invalidado pelas mutações. */
export const getAnnualPanel = ownerCached("annual-panel", getAnnualPanelImpl, {
  revalidate: 300,
  tags: [CACHE_TAGS.DASHBOARD_METRICS],
});
