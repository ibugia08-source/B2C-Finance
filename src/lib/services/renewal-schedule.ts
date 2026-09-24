import { PORTFOLIO_ACTIVE_STATUSES } from "@/lib/client-status";
import { prisma } from "@/lib/prisma";
import { WORKSPACE_TIMEZONE } from "@/lib/format";

/**
 * AGENDA DE RENOVAÇÕES — fonte única de "quem tem renovação prevista em
 * cada mês". Antes, cada tela contava de um jeito: o painel de Renovações
 * unia agenda + contratos; o card "Renovações do mês" do painel principal,
 * a faixa "Próximos meses" e o relatório olhavam SÓ Client.renewalMonth. Um
 * cliente cadastrado com contrato (renewalDate preenchida) e sem mês de
 * renovação aparecia numa tela e sumia da outra — e o dono lia isso como
 * "o sistema não contabiliza as renovações" (24/09/2026).
 *
 * Três fontes, nesta ordem de autoridade, deduplicadas por cliente:
 *  (a) Client.renewalMonth — a agenda editável da carteira;
 *  (b) Contract.renewalDate de contrato vigente (ACTIVE/RENEWAL);
 *  (c) derivada: cliente SEM agenda e SEM contrato vigente, mas com data de
 *      entrada + prazo em meses → renova a cada `contractMonths` a partir da
 *      entrada. É a regra que o cadastro já usa para o fim do contrato.
 *
 * Só clientes em atividade (PORTFOLIO_ACTIVE_STATUSES) entram: quem já saiu
 * aparece no painel do mês pela PERDA registrada, não pela agenda.
 */

export type ScheduledClient = {
  id: string;
  name: string;
  status: string;
  modality: string | null;
  salesOwner: string | null;
  monthlyValue: unknown;
  totalContractValue: unknown;
  paymentDay: number | null;
  contractMonths: number | null;
  startedAt: Date | null;
  renewalMonth: number | null;
  /** De onde veio a previsão — útil para depurar divergências. */
  source: "agenda" | "contrato" | "prazo";
};

export const SCHEDULE_CLIENT_SELECT = {
  id: true, name: true, status: true, modality: true, salesOwner: true,
  monthlyValue: true, totalContractValue: true, paymentDay: true,
  contractMonths: true, startedAt: true, renewalMonth: true,
} as const;

export type MonthKey = { month: number; year: number };

export function monthKey(m: MonthKey): string {
  return `${m.year}-${String(m.month).padStart(2, "0")}`;
}

/**
 * Instante (UTC) em que começa o dia `d` do mês `m`/`y` no fuso do
 * workspace. `new Date(y, m-1, 1)` usa o fuso do SERVIDOR — na Vercel é UTC,
 * três horas à frente da Bahia: uma renovação registrada às 22h do dia 30
 * caía no mês seguinte.
 */
export function zonedMonthStart(year: number, month: number, timeZone = WORKSPACE_TIMEZONE): Date {
  const guess = Date.UTC(year, month - 1, 1, 0, 0, 0);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return new Date(guess - (wall - guess));
}

/** [início, fim) do mês no fuso do workspace. */
export function zonedMonthBounds(year: number, month: number): { start: Date; end: Date } {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return { start: zonedMonthStart(year, month), end: zonedMonthStart(next.year, next.month) };
}

/** Mês/ano de uma data no fuso do workspace. */
export function zonedMonthOf(date: Date, timeZone = WORKSPACE_TIMEZONE): MonthKey {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" })
    .formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === "year")!.value),
    month: Number(parts.find((p) => p.type === "month")!.value),
  };
}

/**
 * Meses (1-12) em que um cliente sem agenda e sem contrato renova, dado
 * entrada + prazo. Retorna vazio quando não há como derivar. Prazo de 12
 * meses → sempre o mesmo mês; prazo de 6 → dois meses; e assim por diante.
 * Só os ciclos que caem dentro da janela pedida são devolvidos.
 */
export function derivedRenewalMonths(
  startedAt: Date | null,
  contractMonths: number | null,
  window: MonthKey[]
): MonthKey[] {
  if (!startedAt || !contractMonths || contractMonths < 1) return [];
  const start = zonedMonthOf(startedAt);
  const startIdx = start.year * 12 + (start.month - 1);
  const out: MonthKey[] = [];
  for (const w of window) {
    const idx = w.year * 12 + (w.month - 1);
    const diff = idx - startIdx;
    if (diff >= contractMonths && diff % contractMonths === 0) out.push(w);
  }
  return out;
}

/**
 * Clientes com renovação prevista em cada um dos meses pedidos.
 * Chave do mapa = `YYYY-MM`; cada cliente aparece no máximo uma vez por mês.
 */
export async function scheduledRenewals(
  window: MonthKey[]
): Promise<Map<string, ScheduledClient[]>> {
  const out = new Map<string, ScheduledClient[]>();
  for (const w of window) out.set(monthKey(w), []);
  if (window.length === 0) return out;

  const active = { in: [...PORTFOLIO_ACTIVE_STATUSES] as any };
  const months = Array.from(new Set(window.map((w) => w.month)));
  const sorted = [...window].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const rangeStart = zonedMonthBounds(first.year, first.month).start;
  const rangeEnd = zonedMonthBounds(last.year, last.month).end;

  const [byAgenda, contracts, byTerm] = await Promise.all([
    prisma.client.findMany({
      where: { renewalMonth: { in: months }, status: active },
      orderBy: { name: "asc" },
      select: SCHEDULE_CLIENT_SELECT,
    }),
    prisma.contract.findMany({
      where: {
        renewalDate: { gte: rangeStart, lt: rangeEnd },
        status: { in: ["ACTIVE", "RENEWAL"] },
        client: { status: active },
      },
      select: { clientId: true, renewalDate: true, client: { select: SCHEDULE_CLIENT_SELECT } },
    }),
    prisma.client.findMany({
      where: {
        renewalMonth: null,
        startedAt: { not: null },
        contractMonths: { not: null },
        status: active,
        // Sem contrato vigente com data: o contrato, quando existe, manda.
        contracts: { none: { status: { in: ["ACTIVE", "RENEWAL"] }, renewalDate: { not: null } } },
      },
      orderBy: { name: "asc" },
      select: SCHEDULE_CLIENT_SELECT,
    }),
  ]);

  const seen = new Map<string, Set<string>>(); // monthKey → clientIds
  const push = (w: MonthKey, c: Omit<ScheduledClient, "source">, source: ScheduledClient["source"]) => {
    const k = monthKey(w);
    if (!out.has(k)) return;
    const ids = seen.get(k) ?? new Set<string>();
    if (ids.has(c.id)) return;
    ids.add(c.id);
    seen.set(k, ids);
    out.get(k)!.push({ ...c, source });
  };

  for (const w of window) {
    for (const c of byAgenda) if (c.renewalMonth === w.month) push(w, c, "agenda");
  }
  for (const ct of contracts) {
    if (!ct.renewalDate) continue;
    push(zonedMonthOf(ct.renewalDate), ct.client, "contrato");
  }
  for (const c of byTerm) {
    for (const w of derivedRenewalMonths(c.startedAt, c.contractMonths, window)) push(w, c, "prazo");
  }

  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  return out;
}
