import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";

/**
 * Métricas financeiras POR CLIENTE em lote (zero N+1).
 * Alimenta a lista da carteira e o detalhe do cliente.
 *
 * Convenções (competência × caixa — nunca somar os dois):
 *  - monthlyValue: contratado ativo (Σ Contract.monthlyValue ACTIVE);
 *    fallback = Client.monthlyValue enquanto não há contratos (Etapa 3).
 *  - totalRevenue: recebido de fato = Σ Billing.paidTotal + Σ Income avulsa
 *    (clientId sem billingId, status RECEIVED) — sem contagem dupla.
 *  - openAmount: Σ (amount − paidTotal) das cobranças PENDING/PARTIAL/OVERDUE.
 */

export type ClientSituation = "EM_DIA" | "INADIMPLENTE" | "SEM_COBRANCA";

export type ClientSummary = {
  activeContracts: number;
  monthlyValue: number; // contratado ativo (fallback aplicado pelo caller)
  totalRevenue: number;
  openAmount: number;
  overdueAmount: number;
  nextDueDate: Date | null;
  nextRenewal: Date | null;
  activeServices: string[];
  situation: ClientSituation;
};

const EMPTY: ClientSummary = {
  activeContracts: 0,
  monthlyValue: 0,
  totalRevenue: 0,
  openAmount: 0,
  overdueAmount: 0,
  nextDueDate: null,
  nextRenewal: null,
  activeServices: [],
  situation: "SEM_COBRANCA",
};


export async function getClientSummaries(
  clientIds: string[]
): Promise<Map<string, ClientSummary>> {
  const map = new Map<string, ClientSummary>(
    clientIds.map((id) => [id, { ...EMPTY, activeServices: [] }])
  );
  if (clientIds.length === 0) return map;

  const [contracts, openBillings, overdueBillings, paidBillings, looseIncomes] =
    await Promise.all([
      prisma.contract.findMany({
        where: { clientId: { in: clientIds }, status: "ACTIVE" },
        select: {
          clientId: true,
          monthlyValue: true,
          renewalDate: true,
          services: { select: { service: { select: { name: true } } } },
        },
      }),
      prisma.billing.groupBy({
        by: ["clientId"],
        where: {
          clientId: { in: clientIds },
          status: { in: ["PENDING", "PARTIAL", "OVERDUE"] },
        },
        _sum: { amount: true, paidTotal: true },
        _min: { dueDate: true },
      }),
      prisma.billing.groupBy({
        by: ["clientId"],
        where: { clientId: { in: clientIds }, status: "OVERDUE" },
        _sum: { amount: true, paidTotal: true },
      }),
      prisma.billing.groupBy({
        by: ["clientId"],
        where: { clientId: { in: clientIds } },
        _sum: { paidTotal: true },
      }),
      prisma.income.groupBy({
        by: ["clientId"],
        where: {
          clientId: { in: clientIds },
          billingId: null,
          status: "RECEIVED",
        },
        _sum: { amount: true },
      }),
    ]);

  for (const c of contracts) {
    const s = map.get(c.clientId);
    if (!s) continue;
    s.activeContracts += 1;
    s.monthlyValue += n(c.monthlyValue);
    if (c.renewalDate && (!s.nextRenewal || c.renewalDate < s.nextRenewal)) {
      s.nextRenewal = c.renewalDate;
    }
    for (const cs of c.services) {
      if (!s.activeServices.includes(cs.service.name)) {
        s.activeServices.push(cs.service.name);
      }
    }
  }

  for (const b of openBillings) {
    const s = map.get(b.clientId);
    if (!s) continue;
    s.openAmount = n(b._sum.amount) - n(b._sum.paidTotal);
    s.nextDueDate = b._min.dueDate ?? null;
    s.situation = "EM_DIA"; // há cobrança aberta e (até aqui) nada vencido
  }

  for (const b of overdueBillings) {
    const s = map.get(b.clientId);
    if (!s) continue;
    s.overdueAmount = n(b._sum.amount) - n(b._sum.paidTotal);
    if (s.overdueAmount > 0) s.situation = "INADIMPLENTE";
  }

  for (const b of paidBillings) {
    const s = map.get(b.clientId);
    if (s) s.totalRevenue += n(b._sum.paidTotal);
  }
  for (const i of looseIncomes) {
    if (!i.clientId) continue;
    const s = map.get(i.clientId);
    if (s) s.totalRevenue += n(i._sum.amount);
  }

  return map;
}

/**
 * Perfil financeiro/risco INDIVIDUAL do cliente (mini-dashboard da área do
 * cliente): quanto tempo está na base, comportamento de pagamento e um rótulo
 * de risco de inadimplência calculado a partir do histórico de cobranças.
 */
export type ClientRiskProfile = {
  monthsActive: number | null; // meses desde a entrada (startedAt)
  paidCount: number; // cobranças quitadas
  overdueCount: number; // cobranças vencidas em aberto AGORA
  lateCount: number; // quitadas com atraso (dentro ou fora do mês)
  onTimeRate: number | null; // 0..1 das quitadas que foram no prazo
  riskLevel: "baixo" | "medio" | "alto" | "sem_historico";
  payerLabel: string; // "Bom pagador" | "Regular" | "Risco — em atraso" | ...
};

export async function getClientRiskProfile(
  clientId: string,
  startedAt: Date | null
): Promise<ClientRiskProfile> {
  const billings = await prisma.billing.findMany({
    where: { clientId, status: { not: "CANCELED" } },
    select: { status: true, isLate: true, paidInDifferentMonth: true },
  });

  let paidCount = 0;
  let overdueCount = 0;
  let lateCount = 0;
  for (const b of billings) {
    if (b.status === "PAID") {
      paidCount += 1;
      if (b.isLate || b.paidInDifferentMonth) lateCount += 1;
    } else if (b.status === "OVERDUE") {
      overdueCount += 1;
    }
  }
  const onTimeRate = paidCount > 0 ? (paidCount - lateCount) / paidCount : null;

  let riskLevel: ClientRiskProfile["riskLevel"];
  let payerLabel: string;
  if (overdueCount > 0) {
    riskLevel = "alto";
    payerLabel = "Risco — em atraso";
  } else if (paidCount === 0) {
    riskLevel = "sem_historico";
    payerLabel = "Sem histórico";
  } else if (paidCount >= 3 && (onTimeRate ?? 0) >= 0.8) {
    riskLevel = "baixo";
    payerLabel = "Bom pagador";
  } else if ((onTimeRate ?? 1) < 0.5) {
    riskLevel = "alto";
    payerLabel = "Pagador irregular";
  } else {
    riskLevel = "medio";
    payerLabel = "Regular";
  }

  const now = new Date();
  const monthsActive = startedAt
    ? Math.max(
        0,
        (now.getFullYear() - startedAt.getFullYear()) * 12 +
          (now.getMonth() - startedAt.getMonth())
      )
    : null;

  return { monthsActive, paidCount, overdueCount, lateCount, onTimeRate, riskLevel, payerLabel };
}

/**
 * Inadimplência do MÊS ATUAL por cliente (rótulo Pago/Devendo/Sem cobrança).
 * Calculado a partir das cobranças da competência (mês/ano):
 *  - DEVENDO  → existe cobrança em aberto (PENDING/PARTIAL/OVERDUE) no mês;
 *  - PAGO     → há cobrança(s) no mês e todas estão quitadas;
 *  - SEM_COBRANCA → nenhuma cobrança gerada para o mês.
 *
 * É apenas o valor CALCULADO. O override manual (Client.delinquencyOverride)
 * é aplicado pelo caller, que sabe a competência gravada. Assim mantemos a
 * separação "automático × ajustado manualmente" pedida no briefing.
 */
export type MonthDelinquency = "PAGO" | "DEVENDO" | "SEM_COBRANCA";

export async function getMonthDelinquencies(
  clientIds: string[],
  month: number,
  year: number
): Promise<Map<string, MonthDelinquency>> {
  const map = new Map<string, MonthDelinquency>(
    clientIds.map((id) => [id, "SEM_COBRANCA"])
  );
  if (clientIds.length === 0) return map;

  const rows = await prisma.billing.groupBy({
    by: ["clientId", "status"],
    where: {
      clientId: { in: clientIds },
      competenceMonth: month,
      competenceYear: year,
    },
    _count: { _all: true },
  });

  // Agrega por cliente: qualquer aberta → DEVENDO; senão alguma paga → PAGO.
  const hasOpen = new Set<string>();
  const hasPaid = new Set<string>();
  for (const r of rows) {
    if (!r._count._all) continue;
    if (r.status === "PENDING" || r.status === "PARTIAL" || r.status === "OVERDUE") {
      hasOpen.add(r.clientId);
    } else if (r.status === "PAID") {
      hasPaid.add(r.clientId);
    }
  }
  for (const id of clientIds) {
    if (hasOpen.has(id)) map.set(id, "DEVENDO");
    else if (hasPaid.has(id)) map.set(id, "PAGO");
    // else permanece SEM_COBRANCA
  }
  return map;
}
