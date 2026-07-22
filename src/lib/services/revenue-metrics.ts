import { BILLING_OPEN_STATUSES } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import { unstable_cache } from "next/cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { toNumber as n } from "@/lib/format";

/**
 * Camada CENTRAL de faturamento MRR/TCV, renovações e perdas.
 * Todas as regras de negócio da B2C vivem aqui — Dashboard, Relatórios e
 * Rotina consomem estas funções; nunca reimplementam o cálculo.
 *
 * Regras (briefing):
 *  - MRR  → recorrente mensal. Cliente MRR ativo fatura TODO mês em que está
 *    ativo. Perdido não conta; Pausado não conta (mês corrente/futuro).
 *  - TCV  → valor TOTAL do contrato pago no mês de adesão/renovação.
 *    NUNCA distribuir pelos meses: entra cheio no mês pago/fechado e os
 *    meses seguintes ficam com faturamento zero até a próxima renovação.
 *    Fonte: cobranças (Billing) revenueType TCV por competência — o cadastro
 *    de cliente TCV já gera exatamente 1 cobrança cheia no mês de lançamento.
 *  - Total do mês = MRR do mês + TCV do mês.
 */


// Status que CONTAM como cliente ativo para faturamento no mês corrente.
// DELINQUENT conta (é ativo devendo); PAUSED/CHURNED/INACTIVE/PROSPECT não.
const REVENUE_ACTIVE_STATUSES = ["ACTIVE", "RENEWAL", "DELINQUENT"] as const;

export type RevenueFilters = {
  modality?: string; // "MRR" | "TCV"
  salesOwner?: string; // responsável
  serviceId?: string; // cliente com contrato ativo do serviço
  segment?: string;
  clientStatus?: string; // status do cliente
  clientId?: string;
};

export type PeriodRevenue = {
  mrr: number; // Σ MRR de cada mês do período
  mrrClients: number; // clientes MRR ativos no último mês do período
  tcv: number; // Σ cobranças TCV com competência no período
  tcvClients: number; // clientes TCV fechados/renovados no período (distintos)
  total: number; // mrr + tcv
};

/** Meses (1º dia) que intersectam o período. Cap de segurança. */
function monthsInRange(start: Date, end: Date, cap = 24): { y: number; m: number }[] {
  const out: { y: number; m: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const endD = new Date(end);
  endD.setDate(endD.getDate() - 1);
  const last = new Date(endD.getFullYear(), endD.getMonth(), 1);
  while (cur <= last && out.length < cap) {
    out.push({ y: cur.getFullYear(), m: cur.getMonth() + 1 });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

/** Filtro de entidade aplicável ao Client (base do MRR e relação do TCV). */
function clientEntityWhere(f: RevenueFilters): Record<string, unknown> {
  const w: Record<string, unknown> = {};
  if (f.clientId) w.id = f.clientId;
  if (f.salesOwner) w.salesOwner = f.salesOwner;
  if (f.segment) w.segment = f.segment;
  if (f.clientStatus) w.status = f.clientStatus;
  if (f.serviceId) {
    w.contracts = {
      some: { status: "ACTIVE", services: { some: { serviceId: f.serviceId } } },
    };
  }
  return w;
}

/**
 * Faturamento do período (mês selecionado ou intervalo).
 *
 * MRR por mês: Σ Client.monthlyValue dos clientes modality=MRR ativos no mês
 * (entrou antes do fim do mês; não perdido antes do início). Para o mês
 * corrente e futuros, Pausado/Inativo/Prospect também não contam; para meses
 * passados usamos entrada/saída (histórico de pausa não é rastreado).
 *
 * TCV por período: Σ Billing revenueType=TCV (competência no período), que é
 * onde o valor cheio da adesão/renovação é lançado — sem rateio mensal.
 */
async function getPeriodRevenueImpl(
  start: Date,
  end: Date,
  filters: RevenueFilters = {}
): Promise<PeriodRevenue> {
  const months = monthsInRange(start, end);
  if (months.length === 0) {
    return { mrr: 0, mrrClients: 0, tcv: 0, tcvClients: 0, total: 0 };
  }

  const wantMrr = !filters.modality || filters.modality === "MRR";
  const wantTcv = !filters.modality || filters.modality === "TCV";
  const entity = clientEntityWhere(filters);

  const [mrrClientsRows, tcvBillings] = await Promise.all([
    wantMrr
      ? prisma.client.findMany({
          where: { ...entity, modality: "MRR" },
          select: {
            id: true,
            monthlyValue: true,
            startedAt: true,
            churnedAt: true,
            status: true,
            createdAt: true,
          },
        })
      : Promise.resolve([] as any[]),
    wantTcv
      ? prisma.billing.findMany({
          where: {
            revenueType: "TCV",
            status: { not: "CANCELED" },
            OR: months.map(({ y, m }) => ({ competenceYear: y, competenceMonth: m })),
            ...(Object.keys(entity).length ? { client: entity } : {}),
          },
          select: { clientId: true, amount: true },
        })
      : Promise.resolve([] as { clientId: string; amount: unknown }[]),
  ]);

  // ---- MRR mês a mês ----
  const now = new Date();
  const currentKey = now.getFullYear() * 12 + now.getMonth();
  let mrr = 0;
  let mrrClients = 0;

  const activeInMonth = (c: (typeof mrrClientsRows)[number], y: number, m: number) => {
    const monthStart = new Date(y, m - 1, 1);
    const monthEnd = new Date(y, m, 1);
    const entered = c.startedAt ?? c.createdAt;
    if (entered && entered >= monthEnd) return false; // ainda não era cliente
    if (c.churnedAt && c.churnedAt < monthStart) return false; // já tinha saído
    // Mês corrente/futuro: o status atual manda (Pausado/Perdido não faturam).
    const key = y * 12 + (m - 1);
    if (key >= currentKey && !REVENUE_ACTIVE_STATUSES.includes(c.status as any)) {
      return false;
    }
    return true;
  };

  for (const { y, m } of months) {
    let monthTotal = 0;
    let count = 0;
    for (const c of mrrClientsRows) {
      if (!activeInMonth(c, y, m)) continue;
      monthTotal += n(c.monthlyValue);
      count += 1;
    }
    mrr += monthTotal;
    mrrClients = count; // fica com o último mês do período
  }

  // ---- TCV do período ----
  let tcv = 0;
  const tcvClientIds = new Set<string>();
  for (const b of tcvBillings) {
    tcv += n(b.amount);
    tcvClientIds.add(b.clientId);
  }

  return {
    mrr,
    mrrClients,
    tcv,
    tcvClients: tcvClientIds.size,
    total: mrr + tcv,
  };
}

// Cache revenue calculations for 1 hour to reduce repeated calculations
// keyParts deve ser string[] estático; os argumentos (start, end) já compõem
// a chave do cache automaticamente via serialização do unstable_cache.
export const getPeriodRevenue = unstable_cache(
  getPeriodRevenueImpl,
  ["period-revenue"],
  { revalidate: 3600, tags: [CACHE_TAGS.REVENUE_METRICS] }
);

// ===================================================================
// Fechamento mensal — RECEBIMENTOS × RECEITA EXTRA (regra oficial B2C)
// Faturamento do mês = Recebimentos no mês correto + Receitas Extras.
//  - Pagamento no mês da competência conta como RECEBIMENTO (mesmo
//    atrasado dentro do mês → flag "pago com atraso").
//  - Pagamento em mês POSTERIOR não entra no mês original (que permanece
//    inadimplente no fechamento) — conta no mês do pagamento como
//    RECUPERAÇÃO DE INADIMPLÊNCIA (direto dos pagamentos, sem registro
//    de Receita Extra: Receita Extra é APENAS manual).
//  - Receita Extra = ExtraRevenue MANUAL + receitas avulsas (Income sem
//    cobrança vinculada). Registros AUTOMATIC legados são ignorados.
// ===================================================================

export type ReceiptsSummary = {
  receiptsCorrectMonth: number; // pagos dentro do mês de competência
  mrrReceived: number; // parte MRR dos recebimentos corretos
  tcvReceived: number; // parte TCV dos recebimentos corretos
  lateSameMonthValue: number; // pagos com atraso mas dentro do mês
  lateSameMonthCount: number;
  paidDifferentMonthValue: number; // recuperações recebidas no período
  paidDifferentMonthCount: number;
  /** recuperação de inadimplência de meses anteriores recebida no período
   * (= paidDifferentMonthValue; mantido p/ compatibilidade de telas) */
  extraRevenueAutomatic: number;
  extraRevenueManual: number; // ExtraRevenue MANUAL + Income avulsa
  extraRevenueTotal: number; // recuperações + manuais
  totalRevenue: number; // receiptsCorrectMonth + extraRevenueTotal
  openAmount: number; // em aberto (competência no período, não quitado)

  // ===== Métricas OFICIAIS do mês (fórmulas do dicionário) =====
  /** Faturamento total previsto: Σ cobranças da competência (exceto canceladas) */
  expectedTotal: number;
  /** Em aberto / Falta receber = max(previsto − recebido, 0) — clamp documentado */
  openMonth: number;
  /** Vencido: parte do em aberto cuja data de vencimento já passou (⊂ Em aberto) */
  overdueOpenAmount: number;
};

export async function getReceiptsSummary(
  start: Date,
  end: Date,
  filters: RevenueFilters = {}
): Promise<ReceiptsSummary> {
  const months = monthsInRange(start, end);
  const entity = clientEntityWhere(filters);
  const clientFilter = Object.keys(entity).length ? { client: entity } : {};

  const [payments, extraRevenues, looseIncomes, openBillings] = await Promise.all([
    prisma.payment.findMany({
      where: {
        status: "CONFIRMED",
        paidAt: { gte: start, lt: end },
        billing: { status: { not: "CANCELED" }, ...(clientFilter as any) },
      },
      select: {
        amount: true,
        paidAt: true,
        billing: {
          select: {
            competenceMonth: true,
            competenceYear: true,
            dueDate: true,
            revenueType: true,
          },
        },
      },
    }),
    prisma.extraRevenue.findMany({
      // Receita Extra é apenas MANUAL (automáticas legadas ficam fora para
      // não duplicar com a recuperação contada direto dos pagamentos).
      where: {
        receivedAt: { gte: start, lt: end },
        origin: "MANUAL",
        ...(clientFilter as any),
      },
      select: { amount: true, origin: true },
    }),
    prisma.income.findMany({
      where: {
        status: "RECEIVED",
        billingId: null,
        receivedAt: { gte: start, lt: end },
        ...(Object.keys(entity).length ? { client: entity } : {}),
      },
      select: { amount: true },
    }),
    months.length
      ? prisma.billing.findMany({
          where: {
            status: { in: [...BILLING_OPEN_STATUSES] },
            OR: months.map(({ y, m }) => ({ competenceYear: y, competenceMonth: m })),
            ...(clientFilter as any),
          },
          select: { amount: true, paidTotal: true, dueDate: true },
        })
      : Promise.resolve(
          [] as { amount: unknown; paidTotal: unknown; dueDate: Date }[]
        ),
  ]);

  // Faturamento total previsto do período: Σ cobranças da competência,
  // exceto canceladas (inclui pagas e em aberto).
  const expectedAgg = months.length
    ? await prisma.billing.aggregate({
        where: {
          status: { not: "CANCELED" },
          OR: months.map(({ y, m }) => ({ competenceYear: y, competenceMonth: m })),
          ...(clientFilter as any),
        },
        _sum: { amount: true },
      })
    : null;
  const expectedTotal = n(expectedAgg?._sum.amount);

  let receiptsCorrectMonth = 0;
  let mrrReceived = 0;
  let tcvReceived = 0;
  let lateSameMonthValue = 0;
  let lateSameMonthCount = 0;
  let paidDifferentMonthValue = 0;
  let paidDifferentMonthCount = 0;

  for (const p of payments) {
    const b = p.billing;
    const compKey = b.competenceYear * 12 + (b.competenceMonth - 1);
    const paidKey = p.paidAt.getFullYear() * 12 + p.paidAt.getMonth();
    const v = n(p.amount);
    if (paidKey === compKey) {
      receiptsCorrectMonth += v;
      if (b.revenueType === "MRR") mrrReceived += v;
      else if (b.revenueType === "TCV") tcvReceived += v;
      if (p.paidAt > b.dueDate) {
        lateSameMonthValue += v;
        lateSameMonthCount += 1;
      }
    } else if (paidKey > compKey) {
      // Recuperação de inadimplência: conta no faturamento do período
      // via extraRevenueAutomatic (abaixo) — nunca no mês original.
      paidDifferentMonthValue += v;
      paidDifferentMonthCount += 1;
    } else {
      // Adiantamento (pagou antes da competência): conta como recebimento.
      receiptsCorrectMonth += v;
      if (b.revenueType === "MRR") mrrReceived += v;
      else if (b.revenueType === "TCV") tcvReceived += v;
    }
  }

  // "Recuperação" agora vem DIRETO dos pagamentos de meses anteriores.
  const extraRevenueAutomatic = paidDifferentMonthValue;
  const extraRevenueManual =
    extraRevenues.reduce((s, e) => s + n(e.amount), 0) +
    looseIncomes.reduce((s, i) => s + n(i.amount), 0);
  const extraRevenueTotal = extraRevenueAutomatic + extraRevenueManual;

  const openAmount = openBillings.reduce(
    (s, b) => s + Math.max(0, n(b.amount) - n(b.paidTotal)),
    0
  );

  // ===== Fórmulas OFICIAIS do mês (dicionário de métricas) =====
  // Em aberto = Faturamento total previsto − Recebido do mês.
  // Clamp em 0: recebido pode superar o previsto (adiantamento de competência
  // futura contado como recebimento) — nunca exibir "em aberto" negativo.
  const openMonth = Math.max(0, expectedTotal - receiptsCorrectMonth);
  // Vencido = parte do em aberto cuja data de vencimento já passou (⊂ Em aberto).
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueOpenAmount = openBillings.reduce(
    (s, b) =>
      (b as any).dueDate < today
        ? s + Math.max(0, n(b.amount) - n(b.paidTotal))
        : s,
    0
  );

  return {
    receiptsCorrectMonth,
    mrrReceived,
    tcvReceived,
    lateSameMonthValue,
    lateSameMonthCount,
    paidDifferentMonthValue,
    paidDifferentMonthCount,
    extraRevenueAutomatic,
    extraRevenueManual,
    extraRevenueTotal,
    totalRevenue: receiptsCorrectMonth + extraRevenueTotal,
    openAmount,
    expectedTotal,
    openMonth,
    overdueOpenAmount,
  };
}

// ===================================================================
// Renovações — mês atual e meses à frente (ou atrás, offset negativo)
// ===================================================================

export type RenewalClient = {
  id: string;
  name: string;
  salesOwner: string | null;
  modality: string | null;
  status: string;
  expected: number; // valor esperado de renovação
};

export type RenewalWindow = {
  offset: number; // 0 = mês atual, 1 = próximo…
  month: number; // 1-12
  year: number;
  label: string; // "Julho/2026"
  count: number;
  expectedTotal: number;
  clients: RenewalClient[];
};

const MONTH_LABEL_PT = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

/**
 * Valor esperado de renovação (regra centralizada):
 *  - TCV → mesmo valor pago na última adesão/fechamento (último contrato TCV;
 *    fallback: última cobrança TCV; fallback final: valor mensal cadastrado).
 *  - MRR → valor mensal recorrente atual do cliente.
 */
async function expectedRenewalValues(
  clients: { id: string; modality: string | null; monthlyValue: unknown }[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const tcvIds = clients.filter((c) => c.modality === "TCV").map((c) => c.id);

  const lastTcvByClient = new Map<string, number>();
  if (tcvIds.length > 0) {
    const [tcvContracts, tcvBillings] = await Promise.all([
      prisma.contract.findMany({
        where: { clientId: { in: tcvIds }, type: "TCV", status: { not: "CANCELED" } },
        orderBy: { startDate: "desc" },
        select: { clientId: true, totalValue: true },
      }),
      prisma.billing.findMany({
        where: { clientId: { in: tcvIds }, revenueType: "TCV", status: { not: "CANCELED" } },
        orderBy: [{ competenceYear: "desc" }, { competenceMonth: "desc" }],
        select: { clientId: true, amount: true },
      }),
    ]);
    for (const c of tcvContracts) {
      if (!lastTcvByClient.has(c.clientId) && n(c.totalValue) > 0) {
        lastTcvByClient.set(c.clientId, n(c.totalValue));
      }
    }
    for (const b of tcvBillings) {
      if (!lastTcvByClient.has(b.clientId) && n(b.amount) > 0) {
        lastTcvByClient.set(b.clientId, n(b.amount));
      }
    }
  }

  for (const c of clients) {
    if (c.modality === "TCV") {
      map.set(c.id, lastTcvByClient.get(c.id) ?? n(c.monthlyValue));
    } else {
      map.set(c.id, n(c.monthlyValue));
    }
  }
  return map;
}

/**
 * Janela de renovações por offset de mês (0 = atual, 1..3 = à frente;
 * negativos = histórico). Usa Client.renewalMonth (editável na carteira).
 */
export async function getRenewalOutlook(
  offsets: number[] = [0, 1, 2, 3]
): Promise<RenewalWindow[]> {
  const now = new Date();

  const clients = await prisma.client.findMany({
    where: {
      renewalMonth: { not: null },
      status: { notIn: ["CHURNED", "INACTIVE", "PROSPECT", "LEAD"] },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      salesOwner: true,
      modality: true,
      status: true,
      renewalMonth: true,
      monthlyValue: true,
    },
  });

  const expected = await expectedRenewalValues(clients);

  return offsets.map((offset) => {
    const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const month = ref.getMonth() + 1;
    const year = ref.getFullYear();
    const windowClients: RenewalClient[] = clients
      .filter((c) => c.renewalMonth === month)
      .map((c) => ({
        id: c.id,
        name: c.name,
        salesOwner: c.salesOwner,
        modality: c.modality,
        status: c.status,
        expected: expected.get(c.id) ?? 0,
      }));
    return {
      offset,
      month,
      year,
      label: `${MONTH_LABEL_PT[month - 1]}/${year}`,
      count: windowClients.length,
      expectedTotal: windowClients.reduce((s, c) => s + c.expected, 0),
      clients: windowClients,
    };
  });
}

// ===================================================================
// Perdas de clientes e receita
// ===================================================================

export type LossItem = {
  clientId: string;
  clientName: string;
  salesOwner: string | null;
  modality: string | null;
  lostAt: Date;
  reason: string | null;
  value: number; // receita perdida (MRR mensal ou TCV de referência)
};

export type LossBucket = { count: number; value: number; items: LossItem[] };

export type LossSummary = {
  currentMonth: LossBucket;
  last3Months: LossBucket; // rolando: do 1º dia de (mês-2) até agora
};

function lossValue(l: { modality: string | null; monthlyValue: unknown; referenceValue: unknown }): number {
  // MRR → mensal perdido; TCV → valor de referência da última adesão.
  if (l.modality === "TCV") return n(l.referenceValue) || n(l.monthlyValue);
  return n(l.monthlyValue) || n(l.referenceValue);
}

/** Churn do PERÍODO FILTRADO (≠ getLossSummary, que é sempre o mês atual). */
export type MonthlyChurn = { count: number; value: number };
export async function getMonthlyChurn(start: Date, end: Date): Promise<MonthlyChurn> {
  const losses = await prisma.clientLoss.findMany({
    where: { lostAt: { gte: start, lt: end } },
    select: { modality: true, monthlyValue: true, referenceValue: true },
  });
  return {
    count: losses.length,
    value: losses.reduce((s, l) => s + lossValue(l), 0),
  };
}

/**
 * Novos clientes do período: entrada = startedAt (fallback createdAt).
 * Receita: MRR → valor mensal; TCV → valor total do último contrato
 * (fallback: valor mensal de referência).
 */
export type NewClientsSummary = { count: number; revenue: number };
export async function getNewClientsSummary(
  start: Date,
  end: Date
): Promise<NewClientsSummary> {
  const clients = await prisma.client.findMany({
    where: {
      OR: [
        { startedAt: { gte: start, lt: end } },
        { startedAt: null, createdAt: { gte: start, lt: end } },
      ],
    },
    select: { id: true, modality: true, monthlyValue: true },
  });
  const tcvIds = clients.filter((c) => c.modality === "TCV").map((c) => c.id);
  const contracts = tcvIds.length
    ? await prisma.contract.findMany({
        where: { clientId: { in: tcvIds } },
        orderBy: { startDate: "desc" },
        select: { clientId: true, totalValue: true },
      })
    : [];
  const lastTcv = new Map<string, number>();
  for (const c of contracts)
    if (!lastTcv.has(c.clientId)) lastTcv.set(c.clientId, n(c.totalValue));

  const revenue = clients.reduce(
    (s, c) =>
      s +
      (c.modality === "TCV"
        ? lastTcv.get(c.id) ?? n(c.monthlyValue)
        : n(c.monthlyValue)),
    0
  );
  return { count: clients.length, revenue };
}

export async function getLossSummary(): Promise<LossSummary> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const threeMonthsStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  const losses = await prisma.clientLoss.findMany({
    where: { lostAt: { gte: threeMonthsStart } },
    orderBy: { lostAt: "desc" },
    select: {
      clientId: true,
      lostAt: true,
      reason: true,
      modality: true,
      monthlyValue: true,
      referenceValue: true,
      salesOwner: true,
      client: { select: { name: true } },
    },
  });

  const toItem = (l: (typeof losses)[number]): LossItem => ({
    clientId: l.clientId,
    clientName: l.client.name,
    salesOwner: l.salesOwner,
    modality: l.modality,
    lostAt: l.lostAt,
    reason: l.reason,
    value: lossValue(l),
  });

  const all = losses.map(toItem);
  const current = all.filter((l) => l.lostAt >= monthStart);

  const bucket = (items: LossItem[]): LossBucket => ({
    count: items.length,
    value: items.reduce((s, i) => s + i.value, 0),
    items,
  });

  return { currentMonth: bucket(current), last3Months: bucket(all) };
}

// ===================================================================
// Snapshot de perda — usado pelas actions ao mudar status → CHURNED
// ===================================================================

export type LossSnapshot = {
  clientId: string;
  modality: string | null;
  monthlyValue: number | null;
  referenceValue: number | null;
  salesOwner: string | null;
};

/**
 * Monta o snapshot de receita perdida por cliente no momento do churn:
 * modalidade + valor mensal + TCV de referência (última adesão) + responsável.
 */
export async function computeLossSnapshots(
  clientIds: string[]
): Promise<LossSnapshot[]> {
  if (clientIds.length === 0) return [];
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds } },
    select: { id: true, modality: true, monthlyValue: true, salesOwner: true },
  });
  const expected = await expectedRenewalValues(
    clients.map((c) => ({ id: c.id, modality: c.modality, monthlyValue: c.monthlyValue }))
  );
  return clients.map((c) => ({
    clientId: c.id,
    modality: c.modality,
    monthlyValue: c.monthlyValue != null ? Number(c.monthlyValue) : null,
    referenceValue: c.modality === "TCV" ? expected.get(c.id) ?? null : null,
    salesOwner: c.salesOwner,
  }));
}
