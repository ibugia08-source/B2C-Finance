import { prisma } from "@/lib/prisma";

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

const n = (v: unknown): number => (v == null ? 0 : Number(v));

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
