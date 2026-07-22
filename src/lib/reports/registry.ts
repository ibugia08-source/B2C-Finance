import { prisma } from "@/lib/prisma";
import { getClientSummaries } from "@/lib/services/client-metrics";
import { getDelinquentClients } from "@/lib/services/billing-metrics";
import {
  getPeriodRevenue,
  getRenewalOutlook,
  getLossSummary,
} from "@/lib/services/revenue-metrics";
import { getUpsellKpis } from "@/lib/services/upsell-metrics";
import { getExpenseSummary } from "@/lib/services/expense-metrics";
import { limitesUsadosPorCartao } from "@/lib/services/calculations";
import { formatBRL, toNumber as n } from "@/lib/format";
import {
  type ReportQuery,
  amountRange,
  dueDateRange,
} from "./query";

/**
 * Registry de relatórios: cada relatório declara colunas, filtros aplicáveis,
 * opções de agrupamento e um builder que devolve linhas cruas (número/Date/
 * string). Formatação acontece na renderização e na exportação — os dados
 * originais nunca são alterados.
 */


export type ColumnKind = "text" | "money" | "int" | "percent" | "date";

export type ReportColumn = {
  key: string;
  label: string;
  kind: ColumnKind;
  /** entra na linha de totais/subtotais */
  total?: boolean;
};

export type FilterField =
  | "periodo"
  | "cliente"
  | "servico"
  | "contrato"
  | "status"
  | "categoria"
  | "responsavel"
  | "tipo"
  | "valor"
  | "vencimento"
  | "competencia"
  | "pago"
  | "situacao";

export type ReportRow = Record<string, string | number | Date | null>;

export type ReportDef = {
  key: string;
  title: string;
  description: string;
  columns: ReportColumn[];
  filterFields: FilterField[];
  /** keys de colunas pelas quais dá para agrupar */
  groupOptions: string[];
  /** opções do select "status" (por domínio) e "tipo" quando aplicável */
  statusOptions?: { value: string; label: string }[];
  tipoOptions?: { value: string; label: string }[];
  defaultSort: { key: string; dir: "asc" | "desc" };
  /** default de período diferente de "mes" (ex.: ano p/ relatório mensal) */
  defaultPeriodo?: string;
  build: (q: ReportQuery) => Promise<ReportRow[]>;
};

const CONTRACT_STATUS_LABEL: Record<string, string> = {
  PENDING: "Pendente",
  ACTIVE: "Ativo",
  RENEWAL: "Em renovação",
  OVERDUE: "Vencido",
  ENDED: "Encerrado",
  CANCELED: "Cancelado",
};
const CLIENT_STATUS_LABEL: Record<string, string> = {
  LEAD: "Lead",
  PROSPECT: "Prospect",
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  PAUSED: "Pausado",
  RENEWAL: "Renovação",
  DELINQUENT: "Inadimplente",
  CHURNED: "Perdido",
};
const EXPENSE_TYPE_LABEL: Record<string, string> = {
  FIXED: "Fixa",
  VARIABLE: "Variável",
  PAYROLL: "Folha",
  TAX: "Imposto",
  TOOL: "Ferramenta",
  ADS: "Mídia/Ads",
  LOAN: "Empréstimo",
  CARD: "Cartão",
  OTHER: "Outra",
};
const ITEM_KIND_LABEL: Record<string, string> = {
  SALARY: "Salário",
  BONUS: "Bônus",
  COMMISSION: "Comissão",
  BENEFIT: "Benefício",
  REIMBURSEMENT: "Reembolso",
  DEDUCTION: "Desconto",
};

// ===================================================================
// Builders
// ===================================================================

/** Meses (1º dia) que intersectam o período, cap 24. */
function monthsInPeriod(q: ReportQuery): { y: number; m: number }[] {
  const out: { y: number; m: number }[] = [];
  const cur = new Date(q.period.start.getFullYear(), q.period.start.getMonth(), 1);
  const endD = new Date(q.period.end);
  endD.setDate(endD.getDate() - 1);
  const last = new Date(endD.getFullYear(), endD.getMonth(), 1);
  while (cur <= last && out.length < 24) {
    out.push({ y: cur.getFullYear(), m: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

async function buildFinanceiroMensal(q: ReportQuery): Promise<ReportRow[]> {
  const months = monthsInPeriod(q);
  if (months.length === 0) return [];
  const { start, end } = q.period;
  const clientWhere = q.clientId ? { clientId: q.clientId } : {};

  const [incomes, txs, payrollItems] = await Promise.all([
    prisma.income.findMany({
      where: { status: "RECEIVED", receivedAt: { gte: start, lt: end }, ...clientWhere },
      select: { receivedAt: true, amount: true },
    }),
    prisma.transaction.findMany({
      where: { date: { gte: start, lt: end }, status: { not: "cancelado" }, type: { in: ["receita", "despesa"] } },
      select: { date: true, amount: true, type: true, status: true },
    }),
    prisma.payrollItem.findMany({
      where: { payroll: { status: { in: ["APPROVED", "PAID"] } } },
      select: { amount: true, kind: true, payroll: { select: { month: true, year: true } } },
    }),
  ]);

  const key = (y: number, m: number) => `${y}-${m}`;
  const idx = new Map(months.map((mo, i) => [key(mo.y, mo.m), i]));
  const zero = () => months.map(() => 0);
  const receitas = zero();
  const despesas = zero();
  const despesasPagas = zero();
  const folha = zero();

  const bucket = (arr: number[], d: Date, v: number) => {
    const i = idx.get(key(d.getFullYear(), d.getMonth() + 1));
    if (i != null) arr[i] += v;
  };
  for (const i of incomes) bucket(receitas, i.receivedAt, n(i.amount));
  for (const t of txs) {
    if (t.type === "receita") bucket(receitas, t.date, n(t.amount));
    else {
      bucket(despesas, t.date, n(t.amount));
      if (t.status === "pago") bucket(despesasPagas, t.date, n(t.amount));
    }
  }
  for (const it of payrollItems) {
    const i = idx.get(key(it.payroll.year, it.payroll.month));
    if (i != null) folha[i] += n(it.amount) * (it.kind === "DEDUCTION" ? -1 : 1);
  }

  return months.map((mo, i) => {
    const lucro = receitas[i] - despesasPagas[i];
    return {
      mes: `${String(mo.m).padStart(2, "0")}/${mo.y}`,
      receitas: receitas[i],
      despesas: despesas[i],
      folha: folha[i],
      lucro,
      margem: receitas[i] > 0 ? Math.round((lucro / receitas[i]) * 100) : 0,
    };
  });
}

async function buildClientes(q: ReportQuery): Promise<ReportRow[]> {
  const where: Record<string, unknown> = {};
  if (q.status) where.status = q.status;
  if (q.clientId) where.id = q.clientId;
  if (q.responsavel)
    where.OR = [
      { salesOwner: { contains: q.responsavel, mode: "insensitive" } },
      { opsOwner: { contains: q.responsavel, mode: "insensitive" } },
    ];
  const clients = await prisma.client.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, name: true, status: true, city: true, state: true, salesOwner: true, createdAt: true },
  });
  const summaries = await getClientSummaries(clients.map((c) => c.id));
  let rows = clients.map((c) => {
    const s = summaries.get(c.id)!;
    return {
      cliente: c.name,
      status: CLIENT_STATUS_LABEL[c.status] ?? c.status,
      cidade: c.city ? `${c.city}${c.state ? "/" + c.state : ""}` : null,
      responsavel: c.salesOwner,
      contratosAtivos: s.activeContracts,
      valorMensal: s.monthlyValue,
      receitaTotal: s.totalRevenue,
      emAberto: s.openAmount,
      vencido: s.overdueAmount,
      desde: c.createdAt,
    };
  });
  if (q.situacao === "inadimplente" || q.situacao === "vencido")
    rows = rows.filter((r) => r.vencido > 0);
  if (q.situacao === "a_vencer") rows = rows.filter((r) => r.vencido === 0 && r.emAberto > 0);
  const range = amountRange(q);
  if (range) rows = rows.filter((r) => (range.gte == null || r.receitaTotal >= range.gte) && (range.lte == null || r.receitaTotal <= range.lte));
  return rows;
}

async function buildInadimplencia(q: ReportQuery): Promise<ReportRow[]> {
  let list = await getDelinquentClients();
  if (q.clientId) {
    const c = await prisma.client.findUnique({ where: { id: q.clientId }, select: { name: true } });
    list = list.filter((d) => d.clientName === c?.name);
  }
  const range = amountRange(q);
  if (range)
    list = list.filter(
      (d) => (range.gte == null || d.totalOverdue >= range.gte) && (range.lte == null || d.totalOverdue <= range.lte)
    );
  return list.map((d) => ({
    cliente: d.clientName,
    valorVencido: d.totalOverdue,
    cobrancas: d.billingCount,
    diasAtraso: d.daysOverdue,
    faixa: d.bucket,
    ultimoContato: d.lastContactAt,
    statusContato: d.lastContactStatus,
  }));
}

async function buildContratos(q: ReportQuery): Promise<ReportRow[]> {
  const where: Record<string, unknown> = {};
  if (q.clientId) where.clientId = q.clientId;
  if (q.status) where.status = q.status;
  if (q.tipo) where.type = q.tipo;
  const contracts = await prisma.contract.findMany({
    where,
    orderBy: { startDate: "desc" },
    select: {
      title: true, type: true, recurrence: true, status: true,
      monthlyValue: true, totalValue: true, startDate: true, endDate: true,
      renewalDate: true, client: { select: { name: true } },
    },
  });
  let rows = contracts.map((c) => ({
    cliente: c.client.name,
    contrato: c.title,
    tipo: c.type,
    status: CONTRACT_STATUS_LABEL[c.status] ?? c.status,
    valorMensal: n(c.monthlyValue),
    valorTotal: n(c.totalValue),
    inicio: c.startDate,
    fim: c.endDate,
    renovacao: c.renewalDate,
  }));
  const range = amountRange(q);
  if (range)
    rows = rows.filter(
      (r) => (range.gte == null || r.valorTotal >= range.gte) && (range.lte == null || r.valorTotal <= range.lte)
    );
  if (q.situacao === "vencido") rows = rows.filter((r) => r.status === CONTRACT_STATUS_LABEL.OVERDUE);
  return rows;
}

async function buildDespesas(q: ReportQuery): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const where: Record<string, unknown> = {
    type: "despesa",
    status: { not: "cancelado" },
    date: { gte: start, lt: end },
  };
  if (q.clientId) where.clientId = q.clientId;
  if (q.serviceId) where.serviceId = q.serviceId;
  if (q.categoryId) where.categoryId = q.categoryId;
  if (q.tipo) where.expenseType = q.tipo;
  if (q.pago === true) where.status = "pago";
  if (q.pago === false) where.status = { in: ["pendente", "devendo"] };
  const range = amountRange(q);
  if (range) where.amount = range;
  const due = dueDateRange(q);
  if (due) where.dueDate = due;

  const txs = await prisma.transaction.findMany({
    where,
    orderBy: { date: "desc" },
    take: 1000,
    select: {
      date: true, description: true, amount: true, status: true,
      dueDate: true, expenseType: true,
      category: { select: { name: true } },
      client: { select: { name: true } },
    },
  });
  return txs.map((t) => ({
    data: t.date,
    descricao: t.description,
    categoria: t.category?.name ?? null,
    tipo: t.expenseType ? EXPENSE_TYPE_LABEL[t.expenseType] ?? t.expenseType : null,
    cliente: t.client?.name ?? null,
    situacao: t.status === "pago" ? "Paga" : t.status === "pendente" ? "Pendente" : t.status,
    vencimento: t.dueDate,
    valor: n(t.amount),
  }));
}

async function buildFolha(q: ReportQuery): Promise<ReportRow[]> {
  const now = new Date();
  const comp = q.competencia ?? { month: now.getMonth() + 1, year: now.getFullYear() };
  const run = await prisma.payroll.findFirst({
    where: { month: comp.month, year: comp.year },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: { employee: { select: { name: true, role: true } } },
      },
    },
  });
  if (!run) return [];
  const RUN_LABEL: Record<string, string> = { DRAFT: "Rascunho", APPROVED: "Aprovada", PAID: "Paga" };
  let rows = run.items.map((i) => ({
    colaborador: i.employee.name,
    cargo: i.employee.role,
    item: ITEM_KIND_LABEL[i.kind] ?? i.kind,
    observacao: i.notes,
    valor: n(i.amount) * (i.kind === "DEDUCTION" ? -1 : 1),
    statusFolha: RUN_LABEL[run.status] ?? run.status,
    competencia: `${String(comp.month).padStart(2, "0")}/${comp.year}`,
  }));
  if (q.responsavel)
    rows = rows.filter((r) => r.colaborador.toLowerCase().includes(q.responsavel!.toLowerCase()));
  return rows;
}

async function buildCaixa(q: ReportQuery): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const [incomes, txs] = await Promise.all([
    prisma.income.findMany({
      where: {
        status: "RECEIVED",
        receivedAt: { gte: start, lt: end },
        ...(q.clientId ? { clientId: q.clientId } : {}),
      },
      select: { receivedAt: true, description: true, amount: true, client: { select: { name: true } } },
    }),
    prisma.transaction.findMany({
      where: {
        date: { gte: start, lt: end },
        status: { not: "cancelado" },
        type: { in: ["receita", "despesa"] },
        ...(q.clientId ? { clientId: q.clientId } : {}),
        ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      },
      take: 2000,
      select: { date: true, description: true, amount: true, type: true, status: true },
    }),
  ]);
  const rows: ReportRow[] = [];
  for (const i of incomes) {
    rows.push({
      data: i.receivedAt,
      descricao: i.description || "Receita",
      origem: i.client?.name ?? "Receita",
      tipo: "Entrada",
      valor: n(i.amount),
    });
  }
  for (const t of txs) {
    if (t.type === "despesa" && t.status !== "pago") continue; // caixa = realizado
    rows.push({
      data: t.date,
      descricao: t.description,
      origem: t.type === "receita" ? "Receita (mov.)" : "Despesa",
      tipo: t.type === "receita" ? "Entrada" : "Saída",
      valor: t.type === "receita" ? n(t.amount) : -n(t.amount),
    });
  }
  const range = amountRange(q);
  return rows
    .filter((r) => {
      if (!range) return true;
      const abs = Math.abs(r.valor as number);
      return (range.gte == null || abs >= range.gte) && (range.lte == null || abs <= range.lte);
    })
    .sort((a, b) => (b.data as Date).getTime() - (a.data as Date).getTime());
}

async function rentabilidade(
  q: ReportQuery,
  by: "client" | "service"
): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const [payments, looseIncomes, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: {
        status: "CONFIRMED",
        paidAt: { gte: start, lt: end },
        ...(q.clientId ? { billing: { clientId: q.clientId } } : {}),
        ...(q.serviceId ? { billing: { serviceId: q.serviceId } } : {}),
      },
      select: { amount: true, billing: { select: { clientId: true, serviceId: true } } },
    }),
    by === "client"
      ? prisma.income.findMany({
          where: {
            status: "RECEIVED",
            billingId: null,
            receivedAt: { gte: start, lt: end },
            clientId: q.clientId ?? { not: null },
          },
          select: { amount: true, clientId: true },
        })
      : Promise.resolve([] as { amount: unknown; clientId: string | null }[]),
    prisma.transaction.findMany({
      where: {
        type: "despesa",
        status: { not: "cancelado" },
        date: { gte: start, lt: end },
        ...(by === "client"
          ? { clientId: q.clientId ?? { not: null } }
          : { serviceId: q.serviceId ?? { not: null } }),
      },
      select: { amount: true, clientId: true, serviceId: true },
    }),
  ]);

  const receita = new Map<string, number>();
  const custo = new Map<string, number>();
  const add = (map: Map<string, number>, id: string | null | undefined, v: number) => {
    if (!id) return;
    map.set(id, (map.get(id) ?? 0) + v);
  };
  for (const p of payments)
    add(receita, by === "client" ? p.billing.clientId : p.billing.serviceId, n(p.amount));
  for (const i of looseIncomes) add(receita, i.clientId, n(i.amount));
  for (const e of expenses) add(custo, by === "client" ? e.clientId : e.serviceId, n(e.amount));

  const ids = Array.from(new Set([...receita.keys(), ...custo.keys()]));
  if (ids.length === 0) return [];
  const names =
    by === "client"
      ? await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : await prisma.service.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameMap = new Map(names.map((x) => [x.id, x.name]));

  return ids.map((id) => {
    const rec = receita.get(id) ?? 0;
    const cus = custo.get(id) ?? 0;
    const res = rec - cus;
    return {
      [by === "client" ? "cliente" : "servico"]: nameMap.get(id) ?? "—",
      receita: rec,
      despesasDiretas: cus,
      resultado: res,
      margem: rec > 0 ? Math.round((res / rec) * 100) : cus > 0 ? -100 : 0,
    };
  });
}

// ===================================================================
// Builders — faturamento MRR/TCV, renovações, perdas, upsell, cartões,
// projeção e executivo (PARTE 10). Todos usam a camada central de
// cálculos — nada de regra duplicada aqui.
// ===================================================================

const MODALITY_LABEL: Record<string, string> = { MRR: "MRR", TCV: "TCV" };
const UPSELL_LABEL: Record<string, string> = {
  OPPORTUNITY: "Oportunidade",
  NEGOTIATION: "Em negociação",
  WON: "Vendido",
  LOST: "Perdido",
  PAUSED: "Pausado",
};

/** Clientes MRR ativos com valor mensal (base do MRR). */
async function buildMrr(q: ReportQuery): Promise<ReportRow[]> {
  const where: Record<string, unknown> = {
    modality: "MRR",
    status: { in: ["ACTIVE", "RENEWAL", "DELINQUENT"] },
  };
  if (q.clientId) where.id = q.clientId;
  if (q.responsavel)
    where.salesOwner = { contains: q.responsavel, mode: "insensitive" };
  const clients = await prisma.client.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      name: true, status: true, segment: true, salesOwner: true,
      monthlyValue: true, renewalMonth: true,
    },
  });
  return clients.map((c) => ({
    cliente: c.name,
    status: CLIENT_STATUS_LABEL[c.status] ?? c.status,
    segmento: c.segment,
    responsavel: c.salesOwner,
    mensal: n(c.monthlyValue),
    anualizado: n(c.monthlyValue) * 12,
    renovacao: c.renewalMonth ? String(c.renewalMonth).padStart(2, "0") : null,
  }));
}

/** Cobranças TCV do período (valor cheio no mês da adesão/renovação). */
async function buildTcv(q: ReportQuery): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const billings = await prisma.billing.findMany({
    where: {
      revenueType: "TCV",
      status: { not: "CANCELED" },
      dueDate: { gte: start, lt: end },
      ...(q.clientId ? { clientId: q.clientId } : {}),
    },
    orderBy: { dueDate: "asc" },
    select: {
      description: true, amount: true, paidTotal: true, status: true,
      competenceMonth: true, competenceYear: true, dueDate: true,
      client: { select: { name: true, salesOwner: true } },
    },
  });
  return billings.map((b) => ({
    cliente: b.client.name,
    descricao: b.description,
    competencia: `${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear}`,
    vencimento: b.dueDate,
    responsavel: b.client.salesOwner,
    situacao: b.status === "PAID" ? "Paga" : b.status === "OVERDUE" ? "Vencida" : "Em aberto",
    valor: n(b.amount),
    recebido: n(b.paidTotal),
  }));
}

/** Faturamento total mês a mês: MRR + TCV (regra central, sem rateio). */
async function buildFaturamentoTotal(q: ReportQuery): Promise<ReportRow[]> {
  const months = monthsInPeriod(q);
  const rows: ReportRow[] = [];
  for (const mo of months) {
    const start = new Date(mo.y, mo.m - 1, 1);
    const end = new Date(mo.y, mo.m, 1);
    const r = await getPeriodRevenue(start, end, {
      salesOwner: q.responsavel ?? undefined,
      clientId: q.clientId ?? undefined,
    });
    rows.push({
      mes: `${String(mo.m).padStart(2, "0")}/${mo.y}`,
      mrr: r.mrr,
      clientesMrr: r.mrrClients,
      tcv: r.tcv,
      clientesTcv: r.tcvClients,
      total: r.total,
    });
  }
  return rows;
}

/** Renovações — mês atual até 5 meses à frente, por cliente. */
async function buildRenovacoes(q: ReportQuery): Promise<ReportRow[]> {
  const outlook = await getRenewalOutlook([0, 1, 2, 3, 4, 5]);
  const rows: ReportRow[] = [];
  for (const w of outlook) {
    for (const c of w.clients) {
      if (q.responsavel && !(c.salesOwner ?? "").toLowerCase().includes(q.responsavel.toLowerCase()))
        continue;
      rows.push({
        mes: w.label,
        cliente: c.name,
        modalidade: c.modality ? MODALITY_LABEL[c.modality] ?? c.modality : null,
        responsavel: c.salesOwner,
        status: CLIENT_STATUS_LABEL[c.status] ?? c.status,
        valorEsperado: c.expected,
      });
    }
  }
  return rows;
}

/** Perdas de clientes no período (registros de churn). */
async function buildPerdas(q: ReportQuery): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const losses = await prisma.clientLoss.findMany({
    where: {
      lostAt: { gte: start, lt: end },
      ...(q.clientId ? { clientId: q.clientId } : {}),
    },
    orderBy: { lostAt: "desc" },
    select: {
      lostAt: true, reason: true, modality: true, salesOwner: true,
      monthlyValue: true, referenceValue: true,
      client: { select: { name: true } },
    },
  });
  let rows = losses.map((l) => ({
    data: l.lostAt,
    cliente: l.client.name,
    modalidade: l.modality ? MODALITY_LABEL[l.modality] ?? l.modality : null,
    responsavel: l.salesOwner,
    motivo: l.reason,
    receitaPerdida:
      l.modality === "TCV"
        ? n(l.referenceValue) || n(l.monthlyValue)
        : n(l.monthlyValue) || n(l.referenceValue),
  }));
  if (q.responsavel)
    rows = rows.filter((r) =>
      (r.responsavel ?? "").toLowerCase().includes(q.responsavel!.toLowerCase())
    );
  return rows;
}

/** Receita perdida por mês (últimos 12 meses). */
async function buildReceitaPerdida(): Promise<ReportRow[]> {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const losses = await prisma.clientLoss.findMany({
    where: { lostAt: { gte: from } },
    select: { lostAt: true, modality: true, monthlyValue: true, referenceValue: true },
  });
  const byMonth = new Map<string, { count: number; value: number }>();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    byMonth.set(`${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`, {
      count: 0,
      value: 0,
    });
  }
  for (const l of losses) {
    const key = `${String(l.lostAt.getMonth() + 1).padStart(2, "0")}/${l.lostAt.getFullYear()}`;
    const cur = byMonth.get(key);
    if (!cur) continue;
    cur.count += 1;
    cur.value +=
      l.modality === "TCV"
        ? n(l.referenceValue) || n(l.monthlyValue)
        : n(l.monthlyValue) || n(l.referenceValue);
  }
  return Array.from(byMonth.entries()).map(([mes, v]) => ({
    mes,
    clientesPerdidos: v.count,
    receitaPerdida: v.value,
  }));
}

/** Carteira agrupada por responsável (ativos, MRR base, perdas 3m). */
async function buildClientesPorResponsavel(): Promise<ReportRow[]> {
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 2);
  threeMonthsAgo.setDate(1);
  const [clients, losses] = await Promise.all([
    prisma.client.findMany({
      where: { status: { notIn: ["INACTIVE", "PROSPECT", "LEAD"] } },
      select: { salesOwner: true, status: true, modality: true, monthlyValue: true },
    }),
    prisma.clientLoss.findMany({
      where: { lostAt: { gte: threeMonthsAgo } },
      select: { salesOwner: true },
    }),
  ]);
  const agg = new Map<
    string,
    { ativos: number; pausados: number; perdidos: number; mrr: number; tcv: number; mrrBase: number; perdas3m: number }
  >();
  const get = (owner: string | null) => {
    const key = owner ?? "Sem responsável";
    if (!agg.has(key))
      agg.set(key, { ativos: 0, pausados: 0, perdidos: 0, mrr: 0, tcv: 0, mrrBase: 0, perdas3m: 0 });
    return agg.get(key)!;
  };
  for (const c of clients) {
    const a = get(c.salesOwner);
    if (c.status === "ACTIVE" || c.status === "RENEWAL" || c.status === "DELINQUENT") {
      a.ativos += 1;
      if (c.modality === "MRR") {
        a.mrr += 1;
        a.mrrBase += n(c.monthlyValue);
      }
      if (c.modality === "TCV") a.tcv += 1;
    }
    if (c.status === "PAUSED") a.pausados += 1;
    if (c.status === "CHURNED") a.perdidos += 1;
  }
  for (const l of losses) get(l.salesOwner).perdas3m += 1;
  return Array.from(agg.entries()).map(([responsavel, a]) => ({
    responsavel,
    clientesAtivos: a.ativos,
    clientesMrr: a.mrr,
    clientesTcv: a.tcv,
    mrrBase: a.mrrBase,
    pausados: a.pausados,
    perdidosTotal: a.perdidos,
    perdas3m: a.perdas3m,
  }));
}

/** Oportunidades de upsell (pipeline + fechadas no período). */
async function buildUpsell(q: ReportQuery): Promise<ReportRow[]> {
  const upsells = await prisma.upsell.findMany({
    where: {
      ...(q.clientId ? { clientId: q.clientId } : {}),
      ...(q.status ? { status: q.status as any } : {}),
    },
    orderBy: [{ status: "asc" }, { expectedCloseAt: "asc" }],
    select: {
      title: true, value: true, responsible: true, status: true,
      expectedCloseAt: true, closedAt: true, createdAt: true,
      client: { select: { name: true } },
      service: { select: { name: true } },
      offer: { select: { name: true } },
    },
  });
  let rows = upsells.map((u) => ({
    cliente: u.client.name,
    oportunidade: u.title ?? u.offer?.name ?? u.service?.name ?? "—",
    alvo: u.offer?.name ?? u.service?.name ?? null,
    responsavel: u.responsible,
    status: UPSELL_LABEL[u.status] ?? u.status,
    criada: u.createdAt,
    previsao: u.expectedCloseAt,
    fechada: u.closedAt,
    valor: n(u.value),
  }));
  if (q.responsavel)
    rows = rows.filter((r) =>
      (r.responsavel ?? "").toLowerCase().includes(q.responsavel!.toLowerCase())
    );
  return rows;
}

/** Cartões e limites (usado × disponível). */
async function buildCartoesLimites(): Promise<ReportRow[]> {
  const cards = await prisma.creditCard.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, bank: true, type: true,
      limitTotal: true, closingDay: true, dueDay: true, active: true,
    },
  });
  const used = await limitesUsadosPorCartao(cards.map((c) => c.id));
  return cards.map((c) => {
    const u = used.get(c.id) ?? 0;
    return {
      cartao: c.name,
      banco: c.bank,
      tipo: c.type,
      limiteTotal: n(c.limitTotal),
      limiteUsado: u,
      limiteDisponivel: Math.max(0, n(c.limitTotal) - u),
      fechaDia: c.closingDay,
      venceDia: c.dueDay,
      situacao: c.active ? "Ativo" : "Inativo",
    };
  });
}

/** Margem operacional por mês (receitas × despesas × folha). */
async function buildMargemOperacional(q: ReportQuery): Promise<ReportRow[]> {
  const rows = await buildFinanceiroMensal(q);
  return rows.map((r) => ({
    mes: r.mes,
    receitas: r.receitas,
    despesas: r.despesas,
    folha: r.folha,
    lucro: r.lucro,
    margem: r.margem,
  }));
}

/** Projeção financeira — próximos 6 meses (MRR + renovações TCV − despesas). */
async function buildProjecaoFinanceira(): Promise<ReportRow[]> {
  const now = new Date();
  const outlook = await getRenewalOutlook([0, 1, 2, 3, 4, 5]);
  const rows: ReportRow[] = [];
  for (let i = 0; i < 6; i++) {
    const start = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
    const [revenue, expenseAgg] = await Promise.all([
      getPeriodRevenue(start, end, {}),
      prisma.transaction.aggregate({
        where: {
          type: "despesa",
          status: { not: "cancelado" },
          dueDate: { gte: start, lt: end },
        },
        _sum: { amount: true },
      }),
    ]);
    const window = outlook[i];
    const tcvEsperado = window
      ? window.clients.filter((c) => c.modality === "TCV").reduce((s, c) => s + c.expected, 0)
      : 0;
    const despesasPrevistas = n(expenseAgg._sum.amount);
    const receitaProjetada = revenue.mrr + Math.max(revenue.tcv, tcvEsperado);
    rows.push({
      mes: `${String(start.getMonth() + 1).padStart(2, "0")}/${start.getFullYear()}`,
      mrrPrevisto: revenue.mrr,
      tcvEsperado: Math.max(revenue.tcv, tcvEsperado),
      receitaProjetada,
      despesasPrevistas,
      resultadoProjetado: receitaProjetada - despesasPrevistas,
    });
  }
  return rows;
}

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

// ===== Fechamento mensal: recebimentos, atrasados, outro mês, receita extra =====

/** Pagamentos do período classificados pela regra de fechamento mensal. */
async function paymentsWithClosing(q: ReportQuery) {
  const { start, end } = q.period;
  const payments = await prisma.payment.findMany({
    where: {
      status: "CONFIRMED",
      paidAt: { gte: start, lt: end },
      billing: {
        status: { not: "CANCELED" },
        ...(q.clientId ? { clientId: q.clientId } : {}),
      },
    },
    orderBy: { paidAt: "desc" },
    select: {
      amount: true,
      paidAt: true,
      method: true,
      billing: {
        select: {
          description: true, dueDate: true, revenueType: true,
          competenceMonth: true, competenceYear: true, collector: true,
          client: { select: { name: true, salesOwner: true } },
        },
      },
    },
  });
  return payments.map((p) => {
    const b = p.billing;
    const compKey = b.competenceYear * 12 + (b.competenceMonth - 1);
    const paidKey = p.paidAt.getFullYear() * 12 + p.paidAt.getMonth();
    return {
      cliente: b.client.name,
      descricao: b.description,
      modalidade: b.revenueType,
      competencia: `${String(b.competenceMonth).padStart(2, "0")}/${b.competenceYear}`,
      vencimento: b.dueDate,
      pagoEm: p.paidAt,
      responsavel: b.collector ?? b.client.salesOwner,
      situacao:
        paidKey > compKey
          ? "Pago em outro mês (Receita Extra)"
          : p.paidAt > b.dueDate
            ? "Pago com atraso"
            : "Pago no prazo",
      _late: paidKey === compKey && p.paidAt > b.dueDate,
      _otherMonth: paidKey > compKey,
      valor: n(p.amount),
    };
  });
}

/** Recebimentos do período (pagamentos, com a classificação do fechamento). */
async function buildRecebimentos(q: ReportQuery): Promise<ReportRow[]> {
  const rows = await paymentsWithClosing(q);
  return rows.map(({ _late, _otherMonth, ...r }) => r);
}

/** Só os pagos com atraso (dentro do mês de competência). */
async function buildPagamentosAtrasados(q: ReportQuery): Promise<ReportRow[]> {
  const rows = await paymentsWithClosing(q);
  return rows.filter((r) => r._late).map(({ _late, _otherMonth, ...r }) => r);
}

/** Só os pagos em mês diferente da competência (viraram Receita Extra). */
async function buildPagosOutroMes(q: ReportQuery): Promise<ReportRow[]> {
  const rows = await paymentsWithClosing(q);
  return rows.filter((r) => r._otherMonth).map(({ _late, _otherMonth, ...r }) => r);
}

const EXTRA_TYPE_LABEL: Record<string, string> = {
  RECOVERY_OF_OVERDUE: "Recuperação de inadimplência",
  MANUAL_EXTRA_REVENUE: "Lançamento manual",
  ONE_TIME_SERVICE: "Serviço pontual",
  ADJUSTMENT: "Ajuste",
  OTHER: "Outra",
};

/** Receitas Extras do período (automáticas + manuais + avulsas). */
async function buildReceitaExtra(q: ReportQuery): Promise<ReportRow[]> {
  const { start, end } = q.period;
  const [extras, loose] = await Promise.all([
    prisma.extraRevenue.findMany({
      // Receita Extra é apenas MANUAL (automáticas legadas ficam fora).
      where: {
        receivedAt: { gte: start, lt: end },
        origin: "MANUAL",
        ...(q.clientId ? { clientId: q.clientId } : {}),
      },
      orderBy: { receivedAt: "desc" },
      select: {
        description: true, amount: true, receivedAt: true, type: true, origin: true,
        originalReferenceMonth: true, originalReferenceYear: true,
        client: { select: { name: true } },
      },
    }),
    prisma.income.findMany({
      where: {
        status: "RECEIVED",
        billingId: null,
        receivedAt: { gte: start, lt: end },
        ...(q.clientId ? { clientId: q.clientId } : {}),
      },
      orderBy: { receivedAt: "desc" },
      select: {
        description: true, amount: true, receivedAt: true,
        client: { select: { name: true } },
      },
    }),
  ]);
  return [
    ...extras.map((e) => ({
      data: e.receivedAt,
      cliente: e.client?.name ?? null,
      descricao: e.description,
      tipo: EXTRA_TYPE_LABEL[e.type] ?? e.type,
      origem: e.origin === "AUTOMATIC" ? "Automática" : "Manual",
      competenciaOriginal: e.originalReferenceMonth
        ? `${String(e.originalReferenceMonth).padStart(2, "0")}/${e.originalReferenceYear}`
        : null,
      valor: n(e.amount),
    })),
    ...loose.map((i) => ({
      data: i.receivedAt,
      cliente: i.client?.name ?? null,
      descricao: i.description || "Receita avulsa",
      tipo: "Entrada avulsa",
      origem: "Manual",
      competenciaOriginal: null,
      valor: n(i.amount),
    })),
  ].sort((a, b) => (b.data as Date).getTime() - (a.data as Date).getTime());
}

// ===================================================================
// Registry
// ===================================================================

export const REPORTS: ReportDef[] = [
  {
    key: "financeiro-mensal",
    title: "Financeiro mensal",
    description: "Receitas, despesas, folha, lucro e margem, mês a mês.",
    columns: [
      { key: "mes", label: "Mês", kind: "text" },
      { key: "receitas", label: "Receitas", kind: "money", total: true },
      { key: "despesas", label: "Despesas", kind: "money", total: true },
      { key: "folha", label: "Folha", kind: "money", total: true },
      { key: "lucro", label: "Lucro/prejuízo", kind: "money", total: true },
      { key: "margem", label: "Margem", kind: "percent" },
    ],
    filterFields: ["periodo", "cliente"],
    groupOptions: [],
    defaultSort: { key: "mes", dir: "asc" },
    defaultPeriodo: "ano",
    build: buildFinanceiroMensal,
  },
  {
    key: "clientes",
    title: "Clientes",
    description: "Carteira com contratos, receita, aberto e vencido por cliente.",
    columns: [
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "cidade", label: "Cidade", kind: "text" },
      { key: "responsavel", label: "Responsável", kind: "text" },
      { key: "contratosAtivos", label: "Contratos ativos", kind: "int", total: true },
      { key: "valorMensal", label: "Valor mensal", kind: "money", total: true },
      { key: "receitaTotal", label: "Receita total", kind: "money", total: true },
      { key: "emAberto", label: "Em aberto", kind: "money", total: true },
      { key: "vencido", label: "Vencido", kind: "money", total: true },
      { key: "desde", label: "Cliente desde", kind: "date" },
    ],
    filterFields: ["cliente", "status", "responsavel", "situacao", "valor"],
    groupOptions: ["status", "responsavel", "cidade"],
    statusOptions: Object.entries(CLIENT_STATUS_LABEL).map(([value, label]) => ({ value, label })),
    defaultSort: { key: "receitaTotal", dir: "desc" },
    build: buildClientes,
  },
  {
    key: "inadimplencia",
    title: "Inadimplência",
    description: "Clientes com valores vencidos, aging e último contato.",
    columns: [
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "valorVencido", label: "Valor vencido", kind: "money", total: true },
      { key: "cobrancas", label: "Cobranças", kind: "int", total: true },
      { key: "diasAtraso", label: "Dias em atraso", kind: "int" },
      { key: "faixa", label: "Faixa", kind: "text" },
      { key: "ultimoContato", label: "Último contato", kind: "date" },
      { key: "statusContato", label: "Retorno", kind: "text" },
    ],
    filterFields: ["cliente", "valor"],
    groupOptions: ["faixa"],
    defaultSort: { key: "valorVencido", dir: "desc" },
    build: buildInadimplencia,
  },
  {
    key: "contratos",
    title: "Acordos comerciais",
    description: "Acordos comerciais (contratos MRR/TCV) com valores, vigência e renovação.",
    columns: [
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "contrato", label: "Contrato", kind: "text" },
      { key: "tipo", label: "Tipo", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "valorMensal", label: "Valor mensal", kind: "money", total: true },
      { key: "valorTotal", label: "Valor total (TCV)", kind: "money", total: true },
      { key: "inicio", label: "Início", kind: "date" },
      { key: "fim", label: "Fim", kind: "date" },
      { key: "renovacao", label: "Renovação", kind: "date" },
    ],
    filterFields: ["cliente", "status", "tipo", "valor", "situacao"],
    groupOptions: ["cliente", "tipo", "status"],
    statusOptions: Object.entries(CONTRACT_STATUS_LABEL).map(([value, label]) => ({ value, label })),
    tipoOptions: [
      { value: "MRR", label: "Recorrente (MRR)" },
      { value: "TCV", label: "Fechado (TCV)" },
      { value: "ONE_TIME", label: "Avulso" },
      { value: "SETUP", label: "Setup" },
    ],
    defaultSort: { key: "inicio", dir: "desc" },
    build: buildContratos,
  },
  {
    key: "despesas",
    title: "Despesas",
    description: "Despesas do período com categoria e tipo.",
    columns: [
      { key: "data", label: "Data", kind: "date" },
      { key: "descricao", label: "Descrição", kind: "text" },
      { key: "categoria", label: "Categoria", kind: "text" },
      { key: "tipo", label: "Tipo", kind: "text" },
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "situacao", label: "Situação", kind: "text" },
      { key: "vencimento", label: "Vencimento", kind: "date" },
      { key: "valor", label: "Valor", kind: "money", total: true },
    ],
    filterFields: ["periodo", "cliente", "servico", "categoria", "tipo", "valor", "vencimento", "pago"],
    groupOptions: ["categoria", "tipo", "cliente", "situacao"],
    tipoOptions: Object.entries(EXPENSE_TYPE_LABEL).map(([value, label]) => ({ value, label })),
    defaultSort: { key: "data", dir: "desc" },
    build: buildDespesas,
  },
  {
    key: "folha",
    title: "Folha de pagamento",
    description: "Itens da folha por competência e colaborador.",
    columns: [
      { key: "colaborador", label: "Colaborador", kind: "text" },
      { key: "cargo", label: "Cargo", kind: "text" },
      { key: "item", label: "Item", kind: "text" },
      { key: "observacao", label: "Observação", kind: "text" },
      { key: "valor", label: "Valor", kind: "money", total: true },
      { key: "statusFolha", label: "Status da folha", kind: "text" },
      { key: "competencia", label: "Competência", kind: "text" },
    ],
    filterFields: ["competencia", "responsavel"],
    groupOptions: ["colaborador", "item"],
    defaultSort: { key: "colaborador", dir: "asc" },
    build: buildFolha,
  },
  {
    key: "caixa",
    title: "Fluxo de caixa",
    description: "Entradas e saídas realizadas no período (saldo nos totais).",
    columns: [
      { key: "data", label: "Data", kind: "date" },
      { key: "descricao", label: "Descrição", kind: "text" },
      { key: "origem", label: "Origem", kind: "text" },
      { key: "tipo", label: "Tipo", kind: "text" },
      { key: "valor", label: "Valor", kind: "money", total: true },
    ],
    filterFields: ["periodo", "cliente", "categoria", "valor"],
    groupOptions: ["tipo", "origem"],
    defaultSort: { key: "data", dir: "desc" },
    build: buildCaixa,
  },
  {
    key: "rentabilidade-cliente",
    title: "Rentabilidade por cliente",
    description: "Receita recebida × despesas diretas alocadas por cliente.",
    columns: [
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "receita", label: "Receita", kind: "money", total: true },
      { key: "despesasDiretas", label: "Despesas diretas", kind: "money", total: true },
      { key: "resultado", label: "Resultado", kind: "money", total: true },
      { key: "margem", label: "Margem", kind: "percent" },
    ],
    filterFields: ["periodo", "cliente"],
    groupOptions: [],
    defaultSort: { key: "resultado", dir: "desc" },
    build: (q) => rentabilidade(q, "client"),
  },
  {
    key: "recebimentos",
    title: "Recebimentos do período",
    description: "Pagamentos recebidos com a classificação do fechamento mensal (no prazo, com atraso, em outro mês).",
    columns: [
      { key: "pagoEm", label: "Pago em", kind: "date" },
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "descricao", label: "Descrição", kind: "text" },
      { key: "modalidade", label: "Modalidade", kind: "text" },
      { key: "competencia", label: "Competência", kind: "text" },
      { key: "vencimento", label: "Vencimento", kind: "date" },
      { key: "situacao", label: "Situação", kind: "text" },
      { key: "responsavel", label: "Responsável", kind: "text" },
      { key: "valor", label: "Valor", kind: "money", total: true },
    ],
    filterFields: ["periodo", "cliente"],
    groupOptions: ["situacao", "modalidade", "cliente", "competencia"],
    defaultSort: { key: "pagoEm", dir: "desc" },
    build: buildRecebimentos,
  },
  {
    key: "receita-extra",
    title: "Receita Extra",
    description: "Lançamentos manuais de Receita Extra e entradas avulsas do período.",
    columns: [
      { key: "data", label: "Recebida em", kind: "date" },
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "descricao", label: "Descrição", kind: "text" },
      { key: "tipo", label: "Tipo", kind: "text" },
      { key: "origem", label: "Origem", kind: "text" },
      { key: "competenciaOriginal", label: "Competência original", kind: "text" },
      { key: "valor", label: "Valor", kind: "money", total: true },
    ],
    filterFields: ["periodo", "cliente"],
    groupOptions: ["tipo", "origem", "cliente"],
    defaultSort: { key: "data", dir: "desc" },
    build: buildReceitaExtra,
  },
  {
    key: "mrr",
    title: "MRR (recorrência)",
    description: "Clientes MRR ativos com valor mensal e anualizado.",
    columns: [
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "segmento", label: "Segmento", kind: "text" },
      { key: "responsavel", label: "Responsável", kind: "text" },
      { key: "mensal", label: "MRR mensal", kind: "money", total: true },
      { key: "anualizado", label: "Anualizado", kind: "money", total: true },
      { key: "renovacao", label: "Mês renovação", kind: "text" },
    ],
    filterFields: ["cliente", "responsavel"],
    groupOptions: ["responsavel", "segmento", "status"],
    defaultSort: { key: "mensal", dir: "desc" },
    build: buildMrr,
  },
  {
    key: "tcv",
    title: "TCV (contratos fechados)",
    description: "Cobranças TCV do período — valor cheio no mês da adesão/renovação.",
    columns: [
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "descricao", label: "Descrição", kind: "text" },
      { key: "competencia", label: "Competência", kind: "text" },
      { key: "vencimento", label: "Vencimento", kind: "date" },
      { key: "responsavel", label: "Responsável", kind: "text" },
      { key: "situacao", label: "Situação", kind: "text" },
      { key: "valor", label: "Valor", kind: "money", total: true },
      { key: "recebido", label: "Recebido", kind: "money", total: true },
    ],
    filterFields: ["periodo", "cliente"],
    groupOptions: ["cliente", "competencia", "situacao"],
    defaultSort: { key: "vencimento", dir: "asc" },
    build: buildTcv,
  },
  {
    key: "renovacoes",
    title: "Renovações",
    description: "Clientes com renovação do mês atual a 5 meses à frente, com valor esperado.",
    columns: [
      { key: "mes", label: "Mês", kind: "text" },
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "modalidade", label: "Modalidade", kind: "text" },
      { key: "responsavel", label: "Responsável", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "valorEsperado", label: "Valor esperado", kind: "money", total: true },
    ],
    filterFields: ["responsavel"],
    groupOptions: ["mes", "responsavel", "modalidade"],
    defaultSort: { key: "mes", dir: "asc" },
    build: buildRenovacoes,
  },
  {
    key: "perdas",
    title: "Perdas de clientes",
    description: "Clientes perdidos no período: data, motivo, responsável e receita perdida.",
    columns: [
      { key: "data", label: "Data da perda", kind: "date" },
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "modalidade", label: "Modalidade", kind: "text" },
      { key: "responsavel", label: "Responsável", kind: "text" },
      { key: "motivo", label: "Motivo", kind: "text" },
      { key: "receitaPerdida", label: "Receita perdida", kind: "money", total: true },
    ],
    filterFields: ["periodo", "cliente", "responsavel"],
    groupOptions: ["responsavel", "modalidade"],
    defaultSort: { key: "data", dir: "desc" },
    build: buildPerdas,
  },
  {
    key: "clientes-por-responsavel",
    title: "Clientes por responsável",
    description: "Carteira agrupada por responsável: ativos, MRR base e perdas.",
    columns: [
      { key: "responsavel", label: "Responsável", kind: "text" },
      { key: "clientesAtivos", label: "Ativos", kind: "int", total: true },
      { key: "clientesMrr", label: "MRR", kind: "int", total: true },
      { key: "clientesTcv", label: "TCV", kind: "int", total: true },
      { key: "mrrBase", label: "MRR base", kind: "money", total: true },
      { key: "pausados", label: "Pausados", kind: "int", total: true },
      { key: "perdidosTotal", label: "Perdidos (total)", kind: "int", total: true },
      { key: "perdas3m", label: "Perdas 3m", kind: "int", total: true },
    ],
    filterFields: [],
    groupOptions: [],
    defaultSort: { key: "mrrBase", dir: "desc" },
    build: buildClientesPorResponsavel,
  },
  {
    key: "upsell",
    title: "Upsell",
    description: "Pipeline de oportunidades de venda interna e resultados.",
    columns: [
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "oportunidade", label: "Oportunidade", kind: "text" },
      { key: "alvo", label: "Serviço/Oferta", kind: "text" },
      { key: "responsavel", label: "Responsável", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "criada", label: "Criada em", kind: "date" },
      { key: "previsao", label: "Previsão", kind: "date" },
      { key: "fechada", label: "Fechada em", kind: "date" },
      { key: "valor", label: "Valor", kind: "money", total: true },
    ],
    filterFields: ["cliente", "responsavel"],
    groupOptions: ["status", "responsavel", "alvo"],
    defaultSort: { key: "valor", dir: "desc" },
    build: buildUpsell,
  },
  {
    key: "cartoes-limites",
    title: "Cartões e limites",
    description: "Limite total, usado e disponível por cartão/conta.",
    columns: [
      { key: "cartao", label: "Cartão/Conta", kind: "text" },
      { key: "banco", label: "Banco", kind: "text" },
      { key: "tipo", label: "Tipo", kind: "text" },
      { key: "limiteTotal", label: "Limite total", kind: "money", total: true },
      { key: "limiteUsado", label: "Usado", kind: "money", total: true },
      { key: "limiteDisponivel", label: "Disponível", kind: "money", total: true },
      { key: "fechaDia", label: "Fecha dia", kind: "int" },
      { key: "venceDia", label: "Vence dia", kind: "int" },
      { key: "situacao", label: "Situação", kind: "text" },
    ],
    filterFields: [],
    groupOptions: ["banco", "situacao"],
    defaultSort: { key: "limiteUsado", dir: "desc" },
    build: buildCartoesLimites,
  },
  {
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
  },
];

export function getReport(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}
