import { BILLING_AWAITING_STATUSES } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import { getExecutiveDashboard } from "@/lib/services/dashboard-metrics";
import { getDelinquentClients } from "@/lib/services/billing-metrics";
import { markOverdueBillings } from "@/lib/services/billing-metrics";

/**
 * Snapshot da AGÊNCIA para a IA (papel ADMIN) — reaproveita os mesmos
 * services já validados do dashboard executivo, então a IA enxerga
 * exatamente os números que o admin vê na tela. Nada é estimado aqui.
 */

const pct = (v: number) => `${Math.round(v * 100)}%`;

export async function buildAgencySnapshotText(): Promise<string> {
  await markOverdueBillings();

  const period = resolvePeriod({ periodo: "mes" });
  const in15 = new Date();
  in15.setDate(in15.getDate() + 15);
  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [dash, delinquents, upcomingBillings, upcomingExpenses, renewals] = await Promise.all([
    getExecutiveDashboard({ period }),
    getDelinquentClients(),
    prisma.billing.findMany({
      where: { status: { in: [...BILLING_AWAITING_STATUSES] }, dueDate: { gte: today, lte: in15 } },
      orderBy: { dueDate: "asc" },
      take: 12,
      select: {
        description: true, amount: true, paidTotal: true, dueDate: true,
        client: { select: { name: true } },
      },
    }),
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { in: ["pendente", "devendo"] },
        OR: [{ dueDate: { gte: today, lte: in15 } }, { dueDate: null, date: { gte: today, lte: in15 } }],
      },
      orderBy: { date: "asc" },
      take: 12,
      select: { description: true, amount: true, dueDate: true, date: true },
    }),
    prisma.contract.findMany({
      where: {
        status: { in: ["ACTIVE", "RENEWAL"] },
        renewalDate: { not: null, lte: in30 },
      },
      orderBy: { renewalDate: "asc" },
      take: 10,
      select: {
        title: true, renewalDate: true, monthlyValue: true,
        client: { select: { name: true } },
      },
    }),
  ]);

  const { kpis, finance, cash, series, breakdowns, health, alerts, revenue, renewalOutlook, losses, receipts } = dash;
  const L: string[] = [];

  L.push(`PERÍODO DE REFERÊNCIA: ${period.label} (hoje: ${formatDateBR(new Date())})`);

  L.push(
    `SAÚDE FINANCEIRA (score do sistema): ${health.score}/100 — ${health.label}. Fatores: ` +
      health.fatores.map((f) => `${f.ok ? "✓" : "✗"} ${f.text}`).join("; ") + "."
  );

  L.push(
    `FATURAMENTO (mês): esperado ${formatBRL(kpis.faturamentoEsperado)}; recebido ${formatBRL(kpis.faturamentoRecebido)}; ` +
      `pendente (no prazo) ${formatBRL(kpis.receitaPendente)}; VENCIDO ${formatBRL(kpis.receitaVencida)}; ` +
      `taxa de inadimplência ${pct(kpis.inadimplenciaTaxa)} (vencido/total em aberto).`
  );

  L.push(
    `COMERCIAL: MRR ativo ${formatBRL(kpis.mrrAtivo)}; TCV vendido no mês ${formatBRL(kpis.tcvVendido)}; ` +
      `clientes ativos ${kpis.clientesAtivos}; novos no mês ${kpis.novosClientes}; ` +
      `inadimplentes ${kpis.clientesInadimplentes}; contratos renovando em 30 dias: ${kpis.contratosEmRenovacao}.`
  );

  L.push(
    `RESULTADO (mês): receitas ${formatBRL(finance.receitas)}; despesas ${formatBRL(finance.despesas)} ` +
      `(fixas ${formatBRL(finance.despesasFixas)}, variáveis ${formatBRL(finance.despesasVariaveis)}, pagas ${formatBRL(finance.despesasPagas)}); ` +
      `folha ${formatBRL(finance.folhaPeriodo)} (${pct(finance.folhaSobreReceita)} da receita; saudável até 40%); ` +
      `LUCRO/PREJUÍZO ${formatBRL(finance.lucro)} (receitas − despesas pagas); margem operacional ${pct(finance.margem)}.`
  );

  L.push(
    `CAIXA: disponível ${formatBRL(cash.caixaDisponivel)} (contas ${formatBRL(cash.contasBancarias)} + reservas ${formatBRL(cash.reservas)}); ` +
      `entradas do mês ${formatBRL(cash.entradasPeriodo)}; saídas ${formatBRL(cash.saidasPeriodo)}; ` +
      `previsto (caixa + a receber − a pagar) ${formatBRL(cash.saldoPrevisto)}; ` +
      `PROJEÇÃO: 30d ${formatBRL(cash.projecao30)}; 60d ${formatBRL(cash.projecao60)}; 90d ${formatBRL(cash.projecao90)}.`
  );

  L.push(
    `FATURAMENTO OFICIAL (fechamento mensal): Faturamento = Recebimentos no mês correto + Receitas Extras. ` +
      `Recebimentos do período ${formatBRL(receipts.receiptsCorrectMonth)} (MRR ${formatBRL(receipts.mrrReceived)} + TCV ${formatBRL(receipts.tcvReceived)}); ` +
      `Receita Extra e recuperações ${formatBRL(receipts.extraRevenueTotal)} (${formatBRL(receipts.extraRevenueAutomatic)} inadimplência de meses anteriores regularizada no período + ${formatBRL(receipts.extraRevenueManual)} Receita Extra MANUAL/avulsas — Receita Extra automática NÃO existe mais); ` +
      `TOTAL ${formatBRL(receipts.totalRevenue)}. ` +
      `Pagos com atraso (dentro do mês): ${receipts.lateSameMonthCount} (${formatBRL(receipts.lateSameMonthValue)}) — contam no mês, com aviso. ` +
      `Pagos em MÊS POSTERIOR à competência: ${receipts.paidDifferentMonthCount} (${formatBRL(receipts.paidDifferentMonthValue)}) — NÃO entram no mês original (que permanece inadimplente no fechamento); contam no mês do pagamento como inadimplência regularizada, sem duplicidade e sem criar Receita Extra. ` +
      `Receita em aberto da competência: ${formatBRL(receipts.openAmount)}.`
  );

  L.push(
    `ESPERADO POR COMPETÊNCIA (referência): MRR ${formatBRL(revenue.mrr)} (${revenue.mrrClients} cliente(s) MRR ativo(s)); ` +
      `TCV ${formatBRL(revenue.tcv)} (${revenue.tcvClients} fechado(s)/renovado(s)); total ${formatBRL(revenue.total)}. ` +
      `Regra: TCV entra CHEIO no mês da adesão/renovação (sem rateio); MRR fatura todo mês em que o cliente está ativo.`
  );

  const rw = renewalOutlook.map(
    (w) => `${w.label}: ${w.count} cliente(s), ${formatBRL(w.expectedTotal)} esperado`
  );
  if (rw.length) L.push(`RENOVAÇÕES (janelas): ${rw.join("; ")}.`);

  L.push(
    `PERDAS: mês atual ${losses.currentMonth.count} cliente(s) / ${formatBRL(losses.currentMonth.value)} de receita perdida; ` +
      `últimos 3 meses ${losses.last3Months.count} cliente(s) / ${formatBRL(losses.last3Months.value)}.` +
      (losses.last3Months.items.length
        ? ` Recentes: ${losses.last3Months.items.slice(0, 5).map((l) => `${l.clientName} (${formatBRL(l.value)}${l.reason ? ` — ${l.reason}` : ""})`).join("; ")}.`
        : "")
  );

  // Tendências — últimos 6 meses
  const last6 = (arr: number[]) => arr.slice(-6);
  const labels6 = series.labels.slice(-6);
  L.push(
    "TENDÊNCIA (últimos 6 meses, ordem cronológica):\n" +
      `  meses: ${labels6.join(", ")}\n` +
      `  receitas: ${last6(series.receitas).map(formatBRL).join(", ")}\n` +
      `  despesas: ${last6(series.despesas).map(formatBRL).join(", ")}\n` +
      `  lucro: ${last6(series.lucro).map(formatBRL).join(", ")}\n` +
      `  MRR: ${last6(series.mrr).map(formatBRL).join(", ")}\n` +
      `  folha % receita: ${last6(series.folhaPct).map((v) => `${v}%`).join(", ")}`
  );

  if (breakdowns.receitaPorCliente.length) {
    L.push(
      "RECEITA POR CLIENTE (recebido no mês): " +
        breakdowns.receitaPorCliente.slice(0, 8).map((s) => `${s.label} ${formatBRL(s.value)}`).join("; ") + "."
    );
  }
  if (breakdowns.receitaPorServico.length) {
    L.push(
      "RECEITA POR SERVIÇO (recebido no mês): " +
        breakdowns.receitaPorServico.slice(0, 8).map((s) => `${s.label} ${formatBRL(s.value)}`).join("; ") + "."
    );
  }
  if (breakdowns.despesasPorCategoria.length) {
    L.push(
      "DESPESAS POR CATEGORIA (mês): " +
        breakdowns.despesasPorCategoria.slice(0, 8).map((s) => `${s.label} ${formatBRL(s.value)}`).join("; ") + "."
    );
  }

  if (delinquents.length) {
    L.push(
      "CLIENTES INADIMPLENTES (por valor): " +
        delinquents.slice(0, 10).map((d) =>
          `${d.clientName} deve ${formatBRL(d.totalOverdue)} (${d.billingCount} cobrança(s), ${d.daysOverdue} dia(s) de atraso, faixa ${d.bucket}` +
          `${d.lastContactAt ? `, último contato ${formatDateBR(d.lastContactAt)}` : ", sem contato registrado"})`
        ).join("; ") + "."
    );
  } else {
    L.push("CLIENTES INADIMPLENTES: nenhum. 🎉");
  }

  if (upcomingBillings.length) {
    L.push(
      "PRÓXIMAS COBRANÇAS A VENCER (15 dias): " +
        upcomingBillings.map((b) =>
          `${b.client.name} — ${b.description} ${formatBRL(Number(b.amount) - Number(b.paidTotal))} vence ${formatDateBR(b.dueDate)}`
        ).join("; ") + "."
    );
  }
  if (upcomingExpenses.length) {
    L.push(
      "PRÓXIMAS DESPESAS A PAGAR (15 dias): " +
        upcomingExpenses.map((e) =>
          `${e.description} ${formatBRL(Number(e.amount))} ${e.dueDate ? `vence ${formatDateBR(e.dueDate)}` : `em ${formatDateBR(e.date)}`}`
        ).join("; ") + "."
    );
  }
  if (renewals.length) {
    L.push(
      "PRÓXIMAS RENOVAÇÕES DE CONTRATO (30 dias): " +
        renewals.map((r) =>
          `"${r.title}" de ${r.client.name} (${formatBRL(Number(r.monthlyValue))}/mês) renova ${r.renewalDate ? formatDateBR(r.renewalDate) : "em breve"}`
        ).join("; ") + "."
    );
  }

  if (alerts.length) {
    L.push("ALERTAS DO SISTEMA: " + alerts.map((a) => `[${a.severity}] ${a.title} — ${a.detail}`).join("; ") + ".");
  }

  return L.join("\n");
}
