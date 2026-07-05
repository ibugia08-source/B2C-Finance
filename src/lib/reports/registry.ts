import { prisma } from "@/lib/prisma";
import { getClientSummaries } from "@/lib/services/client-metrics";
import { getDelinquentClients } from "@/lib/services/billing-metrics";
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

const n = (v: unknown): number => (v == null ? 0 : Number(v));

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
  | "cc"
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
  if (q.costCenterId) where.costCenterId = q.costCenterId;
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
      costCenter: { select: { name: true } },
      client: { select: { name: true } },
    },
  });
  return txs.map((t) => ({
    data: t.date,
    descricao: t.description,
    categoria: t.category?.name ?? null,
    tipo: t.expenseType ? EXPENSE_TYPE_LABEL[t.expenseType] ?? t.expenseType : null,
    centroCusto: t.costCenter?.name ?? null,
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
    title: "Contratos",
    description: "Contratos com valores, vigência e renovação.",
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
    description: "Despesas do período com categoria, tipo e centro de custo.",
    columns: [
      { key: "data", label: "Data", kind: "date" },
      { key: "descricao", label: "Descrição", kind: "text" },
      { key: "categoria", label: "Categoria", kind: "text" },
      { key: "tipo", label: "Tipo", kind: "text" },
      { key: "centroCusto", label: "Centro de custo", kind: "text" },
      { key: "cliente", label: "Cliente", kind: "text" },
      { key: "situacao", label: "Situação", kind: "text" },
      { key: "vencimento", label: "Vencimento", kind: "date" },
      { key: "valor", label: "Valor", kind: "money", total: true },
    ],
    filterFields: ["periodo", "cliente", "servico", "categoria", "cc", "tipo", "valor", "vencimento", "pago"],
    groupOptions: ["categoria", "tipo", "centroCusto", "cliente", "situacao"],
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
    key: "rentabilidade-servico",
    title: "Rentabilidade por serviço",
    description: "Receita recebida × despesas diretas alocadas por serviço.",
    columns: [
      { key: "servico", label: "Serviço", kind: "text" },
      { key: "receita", label: "Receita", kind: "money", total: true },
      { key: "despesasDiretas", label: "Despesas diretas", kind: "money", total: true },
      { key: "resultado", label: "Resultado", kind: "money", total: true },
      { key: "margem", label: "Margem", kind: "percent" },
    ],
    filterFields: ["periodo", "servico"],
    groupOptions: [],
    defaultSort: { key: "resultado", dir: "desc" },
    build: (q) => rentabilidade(q, "service"),
  },
];

export function getReport(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key);
}
