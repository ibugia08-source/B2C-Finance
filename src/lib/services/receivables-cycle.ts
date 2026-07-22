import { prisma } from "@/lib/prisma";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";
import { toNumber as n } from "@/lib/format";
import { resolveOwnerId } from "@/lib/auth/owner-scope";

/**
 * CICLO MENSAL DE RECEBIMENTOS — a "planilha mensal inteligente".
 *
 * Mês selecionado → lista de clientes que devem pagar naquele mês →
 * status de pagamento de cada um.
 *
 * Entram automaticamente no mês:
 *  - clientes ATIVOS de modalidade MRR (gera a mensalidade que faltar);
 *  - clientes TCV/avulsos com cobrança já criada para o mês (adesão,
 *    renovação, setup — criadas pelo cadastro/renovação, nunca rateadas);
 *  - cobranças adicionadas manualmente ao mês.
 * NÃO entram: Perdidos/Pausados/Inativos, removidos do mês (cobrança
 * cancelada — a geração NÃO recria) e TCV fora do mês de adesão/renovação.
 */


/** Status ativo para efeito de faturamento mensal. */
const CYCLE_ACTIVE = ["ACTIVE", "RENEWAL", "DELINQUENT"] as const;

/**
 * Garante as mensalidades MRR do mês (idempotente):
 * cria a cobrança que faltar para cada cliente MRR ativo com valor mensal.
 * Qualquer cobrança MRR já existente na competência — inclusive CANCELADA
 * (= removida do mês) — bloqueia a recriação.
 */
// Throttle em memória por (dono, competência): o ensure é idempotente e só
// gera algo novo quando entra cliente MRR ou vira o mês — não precisa rodar
// a CADA carga de /cobrancas. Mutações de agência chamam
// bustBillingCycleThrottle() (via revalidateAgency), então cliente novo
// aparece imediatamente. Reinicia em cold start — inofensivo.
const ENSURE_TTL_MS = 60 * 60 * 1000;
const lastEnsuredAt = new Map<string, number>();

export function bustBillingCycleThrottle() {
  lastEnsuredAt.clear();
}

export async function ensureMonthlyBillings(
  month: number,
  year: number
): Promise<{ created: number }> {
  const throttleKey = `${(await resolveOwnerId()) ?? "__anon__"}:${year}-${month}`;
  if (Date.now() - (lastEnsuredAt.get(throttleKey) ?? 0) < ENSURE_TTL_MS) {
    return { created: 0 };
  }
  lastEnsuredAt.set(throttleKey, Date.now());

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [clients, existing] = await Promise.all([
    prisma.client.findMany({
      where: {
        status: { in: CYCLE_ACTIVE as any },
        modality: "MRR",
        monthlyValue: { gt: 0 },
      },
      select: {
        id: true,
        name: true,
        paymentDay: true,
        monthlyValue: true,
        startedAt: true,
        createdAt: true,
      },
    }),
    prisma.billing.findMany({
      where: {
        revenueType: "MRR",
        competenceMonth: month,
        competenceYear: year,
      },
      select: { clientId: true },
    }),
  ]);

  const has = new Set(existing.map((b) => b.clientId));
  const rows: any[] = [];
  for (const c of clients) {
    if (has.has(c.id)) continue;
    // Só a partir do mês de entrada do cliente na carteira.
    const entered = c.startedAt ?? c.createdAt;
    if (entered && entered >= monthEnd) continue;
    const dueDate = getValidDueDateForMonth(year, month, c.paymentDay);
    rows.push({
      clientId: c.id,
      description: `Mensalidade ${String(month).padStart(2, "0")}/${year} — ${c.name}`,
      competenceMonth: month,
      competenceYear: year,
      amount: n(c.monthlyValue),
      dueDate,
      revenueType: "MRR",
      status: dueDate < today ? "OVERDUE" : "PENDING",
    });
  }

  if (rows.length > 0) await prisma.billing.createMany({ data: rows });
  return { created: rows.length };
}

// ===================================================================
// Status da linha no ciclo (derivado — interface simples)
// ===================================================================

export type CycleStatus =
  | "UPCOMING" // A vencer
  | "PAID" // Pago no prazo
  | "PAID_LATE" // Pago com atraso (dentro do mês)
  | "PAID_OTHER_MONTH" // Recebido em outro mês (virou Receita Extra)
  | "OVERDUE" // Vencido (passou do vencimento e não pagou — automático)
  | "DELINQUENT" // Inadimplente (marcação manual na lista)
  | "PARTIAL" // Parcialmente pago (interno)
  | "REMOVED"; // Removido do mês (cancelada)

export const CYCLE_STATUS_LABEL: Record<CycleStatus, string> = {
  UPCOMING: "A vencer",
  PAID: "Pago",
  PAID_LATE: "Pago com atraso",
  PAID_OTHER_MONTH: "Recebido em outro mês",
  OVERDUE: "Vencido",
  DELINQUENT: "Inadimplente",
  PARTIAL: "Parcial",
  REMOVED: "Removido do mês",
};

export type CycleRow = {
  billing: {
    id: string;
    status: string;
    isLate: boolean;
    paidInDifferentMonth: boolean;
    dueDate: Date;
    paidAt: Date | null;
    /** collectionStatus ESCALATED = marcado manualmente como Inadimplente */
    collectionStatus?: string | null;
  };
};

/** Deriva o status simples do ciclo + dias de atraso de uma cobrança. */
export function cycleStatusOf(
  b: CycleRow["billing"],
  today: Date = new Date()
): { status: CycleStatus; daysLate: number } {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const msDay = 86_400_000;
  if (b.status === "CANCELED") return { status: "REMOVED", daysLate: 0 };
  if (b.status === "PAID") {
    const daysLate =
      b.paidAt && b.paidAt > b.dueDate
        ? Math.max(1, Math.round((b.paidAt.getTime() - b.dueDate.getTime()) / msDay))
        : 0;
    if (b.paidInDifferentMonth) return { status: "PAID_OTHER_MONTH", daysLate };
    if (b.isLate) return { status: "PAID_LATE", daysLate };
    return { status: "PAID", daysLate: 0 };
  }
  const daysLate =
    b.dueDate < t
      ? Math.max(1, Math.floor((t.getTime() - b.dueDate.getTime()) / msDay))
      : 0;
  // Inadimplente = decisão manual (vale mesmo antes do vencimento).
  if (b.collectionStatus === "ESCALATED") return { status: "DELINQUENT", daysLate };
  if (daysLate > 0) return { status: "OVERDUE", daysLate };
  if (b.status === "PARTIAL") return { status: "PARTIAL", daysLate: 0 };
  return { status: "UPCOMING", daysLate: 0 };
}
