import { prisma } from "@/lib/prisma";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";
import { toNumber as n } from "@/lib/format";

/**
 * Métricas contratuais da agência — separação explícita entre:
 *  - TCV (valor contratado total)         → Contract.totalValue
 *  - MRR ativo (recorrência mensal)       → Σ monthlyValue vigente
 *  - Receita reconhecida por competência  → Σ monthlyValue dos contratos
 *    vigentes NO MÊS (independe do caixa)
 *  - Caixa (recebido de fato)             → Payments/Income (módulo Cobranças)
 *
 * Exemplo canônico: contrato de R$ 5.100 por 3 meses →
 *  TCV 5.100 · reconhecida 1.700/mês · MRR equivalente 1.700 na vigência.
 */


/** Contratos considerados "vigentes" para MRR. */
const LIVE_STATUSES = ["ACTIVE", "RENEWAL"] as const;

/**
 * MRR ativo agora: Σ monthlyValue dos contratos vigentes hoje.
 *
 * ATENÇÃO — métrica CONTRATUAL, diferente do MRR de faturamento
 * (revenue-metrics.getPeriodRevenue, baseado em Client.monthlyValue e
 * cobranças). Os dois coexistem de propósito: este mede carteira de
 * contratos; o outro, faturamento por competência.
 */
export async function mrrAtivo(clientId?: string): Promise<number> {
  const today = new Date();
  const agg = await prisma.contract.aggregate({
    where: {
      ...(clientId ? { clientId } : {}),
      status: { in: LIVE_STATUSES as any },
      startDate: { lte: today },
      OR: [{ endDate: null }, { endDate: { gte: today } }],
    },
    _sum: { monthlyValue: true },
  });
  return n(agg._sum.monthlyValue);
}

/** TCV vendido no período (por data de início do contrato). */
export async function tcvVendido(start: Date, end: Date, clientId?: string): Promise<number> {
  const agg = await prisma.contract.aggregate({
    where: {
      ...(clientId ? { clientId } : {}),
      startDate: { gte: start, lt: end },
      status: { notIn: ["CANCELED"] },
    },
    _sum: { totalValue: true },
  });
  return n(agg._sum.totalValue);
}

/**
 * Receita reconhecida por competência no mês (ref):
 * Σ monthlyValue dos contratos cuja vigência cobre o mês.
 * (setupFee não entra — é reconhecido via cobrança SETUP.)
 */
export async function receitaReconhecidaMes(ref = new Date()): Promise<number> {
  const monthStart = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const monthEnd = new Date(ref.getFullYear(), ref.getMonth() + 1, 1);
  const agg = await prisma.contract.aggregate({
    where: {
      status: { notIn: ["CANCELED", "PENDING"] },
      startDate: { lt: monthEnd },
      OR: [{ endDate: null }, { endDate: { gte: monthStart } }],
    },
    _sum: { monthlyValue: true },
  });
  return n(agg._sum.monthlyValue);
}

/** Renovações nos próximos `dias` (contratos vigentes). */
export async function renovacoesProximas(dias = 30): Promise<number> {
  const limite = new Date();
  limite.setDate(limite.getDate() + dias);
  return prisma.contract.count({
    where: {
      status: { in: LIVE_STATUSES as any },
      renewalDate: { not: null, lte: limite },
    },
  });
}

/** Contratos vencidos: passaram do fim/renovação sem encerrar. */
export function vencidosWhere(): any {
  const today = new Date();
  return {
    OR: [
      { status: "OVERDUE" },
      {
        status: { in: LIVE_STATUSES as any },
        OR: [
          { endDate: { not: null, lt: today } },
          { renewalDate: { not: null, lt: today } },
        ],
      },
    ],
  };
}

// ===================================================================
// Geração de cobranças a partir do contrato
// ===================================================================

/** Meses (1º dia) entre start e end, inclusivo por mês. Cap de segurança. */
function monthsBetween(start: Date, end: Date, cap = 36): { m: number; y: number }[] {
  const out: { m: number; y: number }[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur <= last && out.length < cap) {
    out.push({ m: cur.getMonth() + 1, y: cur.getFullYear() });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

function dueDateFor(y: number, m: number, billingDay: number, notBefore: Date): Date {
  // Dia recorrente 1-31 ajustado ao último dia válido do mês (§8).
  const d = getValidDueDateForMonth(y, m, billingDay);
  return d < notBefore ? notBefore : d;
}

export type GenerateResult = { created: number; skipped: number };

/**
 * Gera as cobranças (Billing) que faltam para um contrato:
 *  - recorrente: uma por mês de competência, do início até endDate
 *    (ou até o mês atual, para contratos sem fim);
 *  - avulso/NONE: uma única cobrança do valor total;
 *  - setupFee: cobrança extra SETUP no primeiro mês.
 * Idempotente: competências que já têm cobrança são puladas.
 */
export async function generateBillingsForContract(
  contractId: string
): Promise<GenerateResult> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      clientId: true,
      title: true,
      type: true,
      recurrence: true,
      monthlyValue: true,
      totalValue: true,
      setupFee: true,
      startDate: true,
      endDate: true,
      billingDay: true,
      status: true,
    },
  });
  if (!contract) return { created: 0, skipped: 0 };

  const today = new Date();
  const revenueType =
    contract.type === "TCV"
      ? "TCV"
      : contract.type === "ONE_TIME"
        ? "ONE_TIME"
        : contract.type === "SETUP"
          ? "SETUP"
          : "MRR";

  const existing = await prisma.billing.findMany({
    where: { contractId: contract.id },
    select: { competenceMonth: true, competenceYear: true, revenueType: true },
  });
  const has = new Set(
    existing.map((b) => `${b.competenceYear}-${b.competenceMonth}-${b.revenueType}`)
  );

  const toCreate: any[] = [];
  const startM = contract.startDate;
  const first = { m: startM.getMonth() + 1, y: startM.getFullYear() };

  // TCV é SEMPRE cobrança única (valor cheio no mês da venda) — nunca rateado,
  // mesmo que um contrato antigo tenha ficado com recurrence != NONE.
  const oneShot =
    contract.recurrence === "NONE" ||
    contract.type === "TCV" ||
    contract.type === "ONE_TIME" ||
    contract.type === "SETUP";

  if (oneShot) {
    const amount = n(contract.totalValue) || n(contract.monthlyValue);
    if (amount > 0 && !has.has(`${first.y}-${first.m}-${revenueType}`)) {
      toCreate.push({
        clientId: contract.clientId,
        contractId: contract.id,
        description: `${contract.title} — ${String(first.m).padStart(2, "0")}/${first.y}`,
        competenceMonth: first.m,
        competenceYear: first.y,
        amount,
        dueDate: dueDateFor(first.y, first.m, contract.billingDay, contract.startDate),
        revenueType,
      });
    }
  } else {
    const horizon = contract.endDate ?? today; // sem fim → gera até o mês atual
    const months = monthsBetween(contract.startDate, horizon);
    const monthly = n(contract.monthlyValue);
    if (monthly > 0) {
      for (const { m, y } of months) {
        if (has.has(`${y}-${m}-${revenueType}`)) continue;
        toCreate.push({
          clientId: contract.clientId,
          contractId: contract.id,
          description: `${contract.title} — ${String(m).padStart(2, "0")}/${y}`,
          competenceMonth: m,
          competenceYear: y,
          amount: monthly,
          dueDate: dueDateFor(y, m, contract.billingDay, contract.startDate),
          revenueType,
        });
      }
    }
  }

  // Setup: cobrança extra no primeiro mês.
  if (n(contract.setupFee) > 0 && !has.has(`${first.y}-${first.m}-SETUP`)) {
    toCreate.push({
      clientId: contract.clientId,
      contractId: contract.id,
      description: `${contract.title} — setup`,
      competenceMonth: first.m,
      competenceYear: first.y,
      amount: n(contract.setupFee),
      dueDate: dueDateFor(first.y, first.m, contract.billingDay, contract.startDate),
      revenueType: "SETUP",
    });
  }

  // Vencidas no passado nascem OVERDUE (histórico honesto).
  const rows = toCreate.map((b) => ({
    ...b,
    status: b.dueDate < today ? "OVERDUE" : "PENDING",
  }));

  if (rows.length > 0) await prisma.billing.createMany({ data: rows });
  return { created: rows.length, skipped: has.size };
}

/** Gera as cobranças do mês corrente para TODOS os contratos vigentes. */
export async function generateBillingsForAllActive(): Promise<GenerateResult> {
  const contracts = await prisma.contract.findMany({
    where: { status: { in: LIVE_STATUSES as any } },
    select: { id: true },
  });
  let created = 0;
  let skipped = 0;
  for (const c of contracts) {
    const r = await generateBillingsForContract(c.id);
    created += r.created;
    skipped += r.skipped;
  }
  return { created, skipped };
}
