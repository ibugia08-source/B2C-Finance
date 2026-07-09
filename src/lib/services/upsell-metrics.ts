import { prisma } from "@/lib/prisma";

/**
 * Métricas de UPSELL (vendas internas para a base).
 * Regras:
 *  - "Aberto" = OPPORTUNITY ou NEGOTIATION (pipeline vivo).
 *  - "Ganho" = WON; entra em valor ganho pelo mês de fechamento (closedAt).
 *  - Taxa de conversão = vendidos / (vendidos + perdidos) — oportunidades
 *    ainda abertas não contam no denominador.
 */

const n = (v: unknown): number => (v == null ? 0 : Number(v));

export const UPSELL_OPEN_STATUSES = ["OPPORTUNITY", "NEGOTIATION"] as const;

export type UpsellKpis = {
  openValue: number; // valor total das oportunidades abertas
  openCount: number;
  wonValue: number; // valor ganho no período (closedAt no período)
  wonCount: number;
  lostCount: number; // perdidos no período
  conversionRate: number; // 0-1 (ganhos / (ganhos+perdidos) no período)
  byResponsible: { label: string; open: number; won: number }[];
  byTarget: { label: string; open: number; won: number }[]; // serviço/oferta
};

export async function getUpsellKpis(start: Date, end: Date): Promise<UpsellKpis> {
  const [open, closedInPeriod] = await Promise.all([
    prisma.upsell.findMany({
      where: { status: { in: UPSELL_OPEN_STATUSES as any } },
      select: {
        value: true,
        responsible: true,
        service: { select: { name: true } },
        offer: { select: { name: true } },
      },
    }),
    prisma.upsell.findMany({
      where: {
        status: { in: ["WON", "LOST"] },
        closedAt: { gte: start, lt: end },
      },
      select: {
        status: true,
        value: true,
        responsible: true,
        service: { select: { name: true } },
        offer: { select: { name: true } },
      },
    }),
  ]);

  const byResp = new Map<string, { open: number; won: number }>();
  const byTarget = new Map<string, { open: number; won: number }>();
  const bump = (
    map: Map<string, { open: number; won: number }>,
    key: string,
    field: "open" | "won",
    v: number
  ) => {
    const cur = map.get(key) ?? { open: 0, won: 0 };
    cur[field] += v;
    map.set(key, cur);
  };
  const targetOf = (u: { service?: { name: string } | null; offer?: { name: string } | null }) =>
    u.offer?.name ?? u.service?.name ?? "Sem serviço/oferta";

  let openValue = 0;
  for (const u of open) {
    openValue += n(u.value);
    bump(byResp, u.responsible ?? "Sem responsável", "open", n(u.value));
    bump(byTarget, targetOf(u), "open", n(u.value));
  }

  let wonValue = 0;
  let wonCount = 0;
  let lostCount = 0;
  for (const u of closedInPeriod) {
    if (u.status === "WON") {
      wonValue += n(u.value);
      wonCount += 1;
      bump(byResp, u.responsible ?? "Sem responsável", "won", n(u.value));
      bump(byTarget, targetOf(u), "won", n(u.value));
    } else {
      lostCount += 1;
    }
  }

  const decided = wonCount + lostCount;
  const toList = (map: Map<string, { open: number; won: number }>) =>
    Array.from(map.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.open + b.won - (a.open + a.won))
      .slice(0, 8);

  return {
    openValue,
    openCount: open.length,
    wonValue,
    wonCount,
    lostCount,
    conversionRate: decided > 0 ? wonCount / decided : 0,
    byResponsible: toList(byResp),
    byTarget: toList(byTarget),
  };
}
