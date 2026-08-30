import { prisma } from "@/lib/prisma";
import { ownerCached } from "@/lib/owner-cache";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { toNumber as n, MONTHS_PT } from "@/lib/format";

/**
 * MÉTRICAS DE RETENÇÃO — o módulo que a auditoria dos dados de 2026 provou
 * ser o mais urgente: a agência perdeu 49 clientes em 8 meses, com vida
 * mediana de 4 meses e churn de 28% em agosto. Nada disso aparecia em tela.
 *
 * Fontes: Client (startedAt/churnedAt/status/modality/monthlyValue/
 * salesOwner/segment) + ClientLoss (lostAt/monthlyValue/reason). Nenhuma
 * tabela nova.
 *
 * Conceitos:
 *  - Churn do mês = perdas do mês ÷ ativos no início do mês.
 *  - Vida (lifetime) = meses entre entrada (startedAt) e saída (churnedAt).
 *  - Zona de risco = clientes ATIVOS com 2 a 6 meses de vida — a faixa onde
 *    84% das perdas históricas aconteceram.
 *  - LTV estimado = ticket médio da base ativa × vida mediana dos perdidos
 *    (estimativa conservadora; rotulada como tal na interface).
 */

const MS_MONTH = 30.44 * 86_400_000;

export type RetentionMonth = {
  month: number; // 1-12
  label: string;
  ativosInicio: number;
  novos: number;
  perdas: number;
  churnRate: number; // 0-1 (0 se sem base)
  mrrPerdido: number;
  mrrNovo: number;
};

export type RiskClient = {
  id: string;
  name: string;
  ageMonths: number;
  monthlyValue: number;
  modality: string | null;
  salesOwner: string | null;
  segment: string | null;
};

export type LossBreakdownRow = { label: string; count: number; mrr: number };

export type CohortRow = {
  label: string; // "1º tri/2026", "2024 e antes"…
  entered: number;
  stillActive: number;
  survival: number; // 0-1
};

export type RetentionPanel = {
  year: number;
  months: RetentionMonth[];
  /** Último mês (1-12) com base de clientes no ano; -1 = nenhum. */
  lastMonthWithData: number;
  totalPerdas: number;
  totalMrrPerdido: number;
  /** Churn do último mês com dados (0-1). */
  churnAtual: number;
  lifetime: {
    n: number;
    medianMonths: number;
    avgMonths: number;
    ate3: number;
    de4a6: number;
    de7a12: number;
    acima12: number;
  };
  /** LTV estimado = ticket médio ativo × vida mediana (rotular como estimativa). */
  ltvEstimado: number;
  ticketMedioAtivo: number;
  riskClients: RiskClient[];
  byOwner: LossBreakdownRow[];
  bySegment: LossBreakdownRow[];
  cohorts: CohortRow[];
};

function monthsBetween(a: Date, b: Date): number {
  return Math.max(0, (b.getTime() - a.getTime()) / MS_MONTH);
}

async function getRetentionPanelImpl(year: number): Promise<RetentionPanel> {
  const yStart = new Date(year, 0, 1);
  const yEnd = new Date(year + 1, 0, 1);
  const now = new Date();

  const [clients, losses] = await Promise.all([
    prisma.client.findMany({
      select: {
        id: true, name: true, status: true, modality: true,
        monthlyValue: true, totalContractValue: true,
        salesOwner: true, segment: true,
        startedAt: true, churnedAt: true, createdAt: true,
      },
      take: 5000,
    }),
    prisma.clientLoss.findMany({
      where: { lostAt: { gte: yStart, lt: yEnd } },
      select: { clientId: true, lostAt: true, monthlyValue: true, salesOwner: true },
      take: 5000,
    }),
  ]);

  const entryOf = (c: (typeof clients)[number]) => c.startedAt ?? c.createdAt;
  const clientById = new Map(clients.map((c) => [c.id, c]));

  // ===== Série mensal do ano =====
  const months: RetentionMonth[] = [];
  let lastMonthWithData = -1;
  for (let m = 1; m <= 12; m++) {
    const mStart = new Date(year, m - 1, 1);
    const mEnd = new Date(year, m, 1);
    if (mStart > now) {
      months.push({ month: m, label: MONTHS_PT[m - 1], ativosInicio: 0, novos: 0, perdas: 0, churnRate: 0, mrrPerdido: 0, mrrNovo: 0 });
      continue;
    }
    let ativosInicio = 0;
    let novos = 0;
    let mrrNovo = 0;
    for (const c of clients) {
      const ent = entryOf(c);
      if (!ent) continue;
      const saiu = c.churnedAt;
      if (ent < mStart && (!saiu || saiu >= mStart)) ativosInicio++;
      if (ent >= mStart && ent < mEnd) {
        novos++;
        if (c.modality !== "TCV") mrrNovo += n(c.monthlyValue);
      }
    }
    const perdasMes = losses.filter((l) => l.lostAt >= mStart && l.lostAt < mEnd);
    const mrrPerdido = perdasMes.reduce((s, l) => s + n(l.monthlyValue), 0);
    if (ativosInicio > 0 || novos > 0) lastMonthWithData = m;
    months.push({
      month: m,
      label: MONTHS_PT[m - 1],
      ativosInicio,
      novos,
      perdas: perdasMes.length,
      churnRate: ativosInicio > 0 ? perdasMes.length / ativosInicio : 0,
      mrrPerdido,
      mrrNovo,
    });
  }

  // ===== Vida dos perdidos (histórico completo, não só o ano) =====
  const vidas: number[] = [];
  for (const c of clients) {
    if (c.status !== "CHURNED") continue;
    const ent = entryOf(c);
    if (!ent || !c.churnedAt || c.churnedAt <= ent) continue;
    vidas.push(monthsBetween(ent, c.churnedAt));
  }
  vidas.sort((a, b) => a - b);
  const nv = vidas.length;
  const lifetime = {
    n: nv,
    medianMonths: nv ? vidas[Math.floor(nv / 2)] : 0,
    avgMonths: nv ? vidas.reduce((s, v) => s + v, 0) / nv : 0,
    ate3: vidas.filter((v) => v <= 3).length,
    de4a6: vidas.filter((v) => v > 3 && v <= 6).length,
    de7a12: vidas.filter((v) => v > 6 && v <= 12).length,
    acima12: vidas.filter((v) => v > 12).length,
  };

  // ===== Ticket médio ativo e LTV estimado =====
  const ativos = clients.filter((c) => c.status === "ACTIVE");
  const mrrAtivos = ativos.filter((c) => c.modality !== "TCV");
  const ticketMedioAtivo =
    mrrAtivos.length > 0
      ? mrrAtivos.reduce((s, c) => s + n(c.monthlyValue), 0) / mrrAtivos.length
      : 0;
  const ltvEstimado = ticketMedioAtivo * lifetime.medianMonths;

  // ===== Zona de risco: ativos com 2-6 meses de vida =====
  const riskClients: RiskClient[] = ativos
    .map((c) => {
      const ent = entryOf(c);
      return {
        id: c.id,
        name: c.name,
        ageMonths: ent ? monthsBetween(ent, now) : 0,
        monthlyValue: c.modality === "TCV" ? n(c.totalContractValue) : n(c.monthlyValue),
        modality: c.modality,
        salesOwner: c.salesOwner,
        segment: c.segment,
      };
    })
    .filter((c) => c.ageMonths >= 2 && c.ageMonths <= 6)
    .sort((a, b) => b.monthlyValue - a.monthlyValue);

  // ===== Perdas por responsável e por segmento (ano) =====
  const ownerAgg = new Map<string, { count: number; mrr: number }>();
  const segAgg = new Map<string, { count: number; mrr: number }>();
  for (const l of losses) {
    const owner = l.salesOwner ?? clientById.get(l.clientId)?.salesOwner ?? "Sem responsável";
    const seg = clientById.get(l.clientId)?.segment ?? "Sem segmento";
    const o = ownerAgg.get(owner) ?? { count: 0, mrr: 0 };
    o.count++; o.mrr += n(l.monthlyValue);
    ownerAgg.set(owner, o);
    const s = segAgg.get(seg) ?? { count: 0, mrr: 0 };
    s.count++; s.mrr += n(l.monthlyValue);
    segAgg.set(seg, s);
  }
  const toRows = (m: Map<string, { count: number; mrr: number }>): LossBreakdownRow[] =>
    Array.from(m.entries())
      .map(([label, v]) => ({ label, count: v.count, mrr: v.mrr }))
      .sort((a, b) => b.count - a.count);

  // ===== Coortes de entrada =====
  const cohortKey = (d: Date): string => {
    if (d.getFullYear() < year) return `${year - 1} e antes`;
    const tri = Math.floor(d.getMonth() / 3) + 1;
    return `${tri}º tri/${year}`;
  };
  const cohortAgg = new Map<string, { entered: number; stillActive: number }>();
  for (const c of clients) {
    const ent = entryOf(c);
    if (!ent) continue;
    const k = cohortKey(ent);
    const v = cohortAgg.get(k) ?? { entered: 0, stillActive: 0 };
    v.entered++;
    if (c.status === "ACTIVE") v.stillActive++;
    cohortAgg.set(k, v);
  }
  const cohortOrder = [`${year - 1} e antes`, `1º tri/${year}`, `2º tri/${year}`, `3º tri/${year}`, `4º tri/${year}`];
  const cohorts: CohortRow[] = cohortOrder
    .filter((k) => cohortAgg.has(k))
    .map((k) => {
      const v = cohortAgg.get(k)!;
      return { label: k, entered: v.entered, stillActive: v.stillActive, survival: v.entered > 0 ? v.stillActive / v.entered : 0 };
    });

  const churnAtual = lastMonthWithData > 0 ? months[lastMonthWithData - 1].churnRate : 0;

  return {
    year,
    months,
    lastMonthWithData,
    totalPerdas: losses.length,
    totalMrrPerdido: losses.reduce((s, l) => s + n(l.monthlyValue), 0),
    churnAtual,
    lifetime,
    ltvEstimado,
    ticketMedioAtivo,
    riskClients,
    byOwner: toRows(ownerAgg),
    bySegment: toRows(segAgg),
    cohorts,
  };
}

export const getRetentionPanel = ownerCached("retention-panel", getRetentionPanelImpl, {
  revalidate: 300,
  tags: [CACHE_TAGS.CLIENTS, CACHE_TAGS.DASHBOARD_METRICS],
});
