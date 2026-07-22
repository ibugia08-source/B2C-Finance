import { BILLING_AWAITING_STATUSES, BILLING_OPEN_STATUSES } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import { toNumber as n } from "@/lib/format";

/**
 * Métricas de cobrança. Convenções:
 *  - "em aberto" = amount − paidTotal das cobranças PENDING/PARTIAL/OVERDUE
 *  - recebido = Σ Payment CONFIRMED no período (caixa)
 *  - vencido = em aberto com status OVERDUE
 *  - a vencer = em aberto com vencimento >= hoje
 */

export const OPEN_STATUSES = BILLING_OPEN_STATUSES;

/**
 * Marca como OVERDUE toda cobrança aberta com vencimento no passado.
 * Chamada nas páginas de cobrança (barata: 1 updateMany indexado).
 */
export async function markOverdueBillings(): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const r = await prisma.billing.updateMany({
    where: { status: { in: [...BILLING_AWAITING_STATUSES] }, dueDate: { lt: today } },
    data: { status: "OVERDUE" },
  });
  return r.count;
}

export type BillingKpis = {
  totalAReceber: number;
  recebidoPeriodo: number;
  totalVencido: number;
  totalAVencer: number;
  totalParcial: number;
  clientesInadimplentes: number;
};

export async function getBillingKpis(
  periodStart: Date,
  periodEnd: Date
): Promise<BillingKpis> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [open, overdue, toCome, partial, received, delinquents] = await Promise.all([
    prisma.billing.aggregate({
      where: { status: { in: OPEN_STATUSES as any } },
      _sum: { amount: true, paidTotal: true },
    }),
    prisma.billing.aggregate({
      where: { status: "OVERDUE" },
      _sum: { amount: true, paidTotal: true },
    }),
    prisma.billing.aggregate({
      where: { status: { in: [...BILLING_AWAITING_STATUSES] }, dueDate: { gte: today } },
      _sum: { amount: true, paidTotal: true },
    }),
    prisma.billing.aggregate({
      where: { status: "PARTIAL" },
      _sum: { amount: true, paidTotal: true },
    }),
    prisma.payment.aggregate({
      where: { status: "CONFIRMED", paidAt: { gte: periodStart, lt: periodEnd } },
      _sum: { amount: true },
    }),
    prisma.billing.groupBy({
      by: ["clientId"],
      where: { status: "OVERDUE" },
    }),
  ]);

  const openOf = (a: { _sum: { amount: any; paidTotal: any } }) =>
    n(a._sum.amount) - n(a._sum.paidTotal);

  return {
    totalAReceber: openOf(open),
    recebidoPeriodo: n(received._sum.amount),
    totalVencido: openOf(overdue),
    totalAVencer: openOf(toCome),
    totalParcial: openOf(partial),
    clientesInadimplentes: delinquents.length,
  };
}

// ===== Inadimplência (aging) ========================================

export type AgingBucket = "1-15" | "16-30" | "31-60" | "60+";

export type DelinquentClient = {
  clientId: string;
  clientName: string;
  phone: string | null;
  totalOverdue: number;
  oldestDueDate: Date;
  daysOverdue: number;
  billingCount: number;
  bucket: AgingBucket;
  lastContactAt: Date | null;
  lastContactStatus: string | null;
};

export async function getDelinquentClients(): Promise<DelinquentClient[]> {
  const billings = await prisma.billing.findMany({
    where: { status: "OVERDUE" },
    select: {
      clientId: true,
      amount: true,
      paidTotal: true,
      dueDate: true,
      client: { select: { name: true, phone: true } },
    },
  });
  if (billings.length === 0) return [];

  const byClient = new Map<string, DelinquentClient>();
  const today = new Date();

  for (const b of billings) {
    const openAmount = n(b.amount) - n(b.paidTotal);
    const cur = byClient.get(b.clientId);
    if (!cur) {
      byClient.set(b.clientId, {
        clientId: b.clientId,
        clientName: b.client.name,
        phone: b.client.phone,
        totalOverdue: openAmount,
        oldestDueDate: b.dueDate,
        daysOverdue: 0,
        billingCount: 1,
        bucket: "1-15",
        lastContactAt: null,
        lastContactStatus: null,
      });
    } else {
      cur.totalOverdue += openAmount;
      cur.billingCount += 1;
      if (b.dueDate < cur.oldestDueDate) cur.oldestDueDate = b.dueDate;
    }
  }

  // Último contato de cobrança por cliente (1 query)
  const contacts = await prisma.collectionHistory.findMany({
    where: { clientId: { in: Array.from(byClient.keys()) } },
    orderBy: { contactedAt: "desc" },
    select: { clientId: true, contactedAt: true, status: true },
  });
  for (const c of contacts) {
    const cur = c.clientId ? byClient.get(c.clientId) : undefined;
    if (cur && !cur.lastContactAt) {
      cur.lastContactAt = c.contactedAt;
      cur.lastContactStatus = c.status;
    }
  }

  const out = Array.from(byClient.values());
  for (const c of out) {
    c.daysOverdue = Math.max(
      1,
      Math.floor((today.getTime() - c.oldestDueDate.getTime()) / 86_400_000)
    );
    c.bucket =
      c.daysOverdue <= 15
        ? "1-15"
        : c.daysOverdue <= 30
          ? "16-30"
          : c.daysOverdue <= 60
            ? "31-60"
            : "60+";
  }
  return out.sort((a, b) => b.totalOverdue - a.totalOverdue);
}
