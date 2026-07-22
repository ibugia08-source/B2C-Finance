import { prisma } from "@/lib/prisma";
import {
  getPeriodRevenue,
  getRenewalOutlook,
  getLossSummary,
} from "@/lib/services/revenue-metrics";
import { getUpsellKpis } from "@/lib/services/upsell-metrics";
import { getExpenseSummary } from "@/lib/services/expense-metrics";
import { formatBRL } from "@/lib/format";
import { type ReportQuery } from "../query";
import { type ReportDef, type ReportRow } from "../shared";

/** Relatório executivo — visão única dos principais indicadores. */
async function buildExecutivo(q: ReportQuery): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const [revenue, outlook, losses, upsell, expenses, clientes, devendo] =
    await Promise.all([
      getPeriodRevenue(start, end, {}),
      getRenewalOutlook([0, 1, 2, 3]),
      getLossSummary(),
      getUpsellKpis(start, end),
      getExpenseSummary(start),
      prisma.client.count({ where: { status: "ACTIVE" } }),
      prisma.client.count({ where: { status: "DELINQUENT" } }),
    ]);
  const rows: ReportRow[] = [
    { grupo: "Faturamento", indicador: "Faturamento MRR", valor: formatBRL(revenue.mrr) },
    { grupo: "Faturamento", indicador: "Faturamento TCV", valor: formatBRL(revenue.tcv) },
    { grupo: "Faturamento", indicador: "Faturamento total", valor: formatBRL(revenue.total) },
    { grupo: "Clientes", indicador: "Clientes ativos", valor: String(clientes) },
    { grupo: "Clientes", indicador: "Clientes MRR ativos", valor: String(revenue.mrrClients) },
    { grupo: "Clientes", indicador: "Clientes inadimplentes", valor: String(devendo) },
    ...outlook.map((w) => ({
      grupo: "Renovações",
      indicador: `Renovações ${w.label}`,
      valor: `${w.count} cliente(s) · ${formatBRL(w.expectedTotal)}`,
    })),
    { grupo: "Perdas", indicador: "Perdidos no mês", valor: `${losses.currentMonth.count} · ${formatBRL(losses.currentMonth.value)}` },
    { grupo: "Perdas", indicador: "Perdidos (3 meses)", valor: `${losses.last3Months.count} · ${formatBRL(losses.last3Months.value)}` },
    { grupo: "Upsell", indicador: "Pipeline aberto", valor: `${upsell.openCount} · ${formatBRL(upsell.openValue)}` },
    { grupo: "Upsell", indicador: "Ganho no período", valor: `${upsell.wonCount} · ${formatBRL(upsell.wonValue)}` },
    { grupo: "Upsell", indicador: "Conversão", valor: `${Math.round(upsell.conversionRate * 100)}%` },
    { grupo: "Despesas", indicador: "Despesas do mês", valor: formatBRL(expenses.total) },
    { grupo: "Despesas", indicador: "Despesas vencidas", valor: formatBRL(expenses.overdue) },
    { grupo: "Despesas", indicador: "Débitos de cartão", valor: formatBRL(expenses.invoiceOpenTotal) },
    { grupo: "Despesas", indicador: "Limite disponível", valor: formatBRL(expenses.creditLimitAvailable) },
    { grupo: "Resultado", indicador: "Resultado bruto (fat. − desp.)", valor: formatBRL(revenue.total - expenses.total) },
  ];
  return rows;
}

export const executivoReport: ReportDef = {
  key: "executivo",
  title: "Executivo da agência",
  description: "Visão única dos principais indicadores do período.",
  columns: [
    { key: "grupo", label: "Grupo", kind: "text" },
    { key: "indicador", label: "Indicador", kind: "text" },
    { key: "valor", label: "Valor", kind: "text" },
  ],
  filterFields: ["periodo"],
  groupOptions: ["grupo"],
  defaultSort: { key: "grupo", dir: "asc" },
  build: buildExecutivo,
};
