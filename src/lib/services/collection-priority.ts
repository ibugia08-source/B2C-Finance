// Cliente cuja receita dos últimos 90 dias representa ≥ 20% do total é "key account"
const KEY_ACCOUNT_REVENUE_SHARE = 0.2;

import { prisma } from "@/lib/prisma";
import { getDelinquentClients } from "./billing-metrics";
import type { MessageTone } from "@/lib/billing-message";

/**
 * Fila de cobrança priorizada — transforma a lista de inadimplentes em uma
 * fila de AÇÃO com score, classificação (alta/média/baixa), motivo legível
 * e tom de mensagem sugerido.
 *
 * Regras de pontuação (documentadas no relatório da etapa):
 *  - Dias de atraso:       1-15 → +8 · 16-30 → +15 · 31-60 → +22 · 60+ → +30
 *  - Valor em aberto:      >5k → +25 · >2k → +18 · >1k → +12 · >500 → +8 · senão +4
 *  - Cliente recorrente:   contrato MRR vigente → +10 (receita futura em risco)
 *  - Renovação próxima:    renova em ≤30 dias → +10 (resolver antes de renovar)
 *  - Importância:          ≥20% da receita recebida nos últimos 90 dias → +10
 *  - Histórico:            ≥3 cobranças vencidas do cliente → +8 (reincidente)
 *  - Tentativas:           ≥3 contatos sem pagamento → +8 (escalar abordagem)
 *  - Promessa vencida:     prometeu pagar e a data passou → +12
 * Classificação: ≥60 ALTA · ≥35 MÉDIA · <35 BAIXA.
 */

export type QueuePriority = "alta" | "media" | "baixa";

export type CollectionQueueItem = {
  clientId: string;
  clientName: string;
  phone: string | null;
  totalOverdue: number;
  daysOverdue: number;
  billingCount: number;
  attempts: number;
  lastContactAt: Date | null;
  lastContactStatus: string | null;
  promise: { at: Date | null; broken: boolean } | null; // última promessa de pagamento
  recurring: boolean;
  renewalSoon: boolean;
  keyAccount: boolean; // ≥20% da receita (90d)
  score: number;
  priority: QueuePriority;
  reasons: string[];
  suggestedTone: MessageTone;
  contactedToday: boolean;
  // cobrança-âncora (mais antiga em aberto) para registrar contato/pagamento
  anchorBilling: {
    id: string;
    description: string;
    openAmount: number;
    dueDate: Date;
    serviceNames: string[];
  };
};

export async function getCollectionQueue(): Promise<CollectionQueueItem[]> {
  const delinquents = await getDelinquentClients();
  if (delinquents.length === 0) return [];
  const ids = delinquents.map((d) => d.clientId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d90 = new Date();
  d90.setDate(d90.getDate() - 90);

  const [histories, contracts, payments90, oldestBillings, services] = await Promise.all([
    prisma.collectionHistory.findMany({
      where: { clientId: { in: ids } },
      orderBy: { contactedAt: "desc" },
      select: { clientId: true, status: true, contactedAt: true, nextActionAt: true },
    }),
    prisma.contract.findMany({
      where: {
        clientId: { in: ids },
        status: { in: ["ACTIVE", "RENEWAL"] },
      },
      select: { clientId: true, recurrence: true, renewalDate: true },
    }),
    prisma.payment.findMany({
      where: { status: "CONFIRMED", paidAt: { gte: d90 } },
      select: { amount: true, billing: { select: { clientId: true } } },
    }),
    prisma.billing.findMany({
      where: { clientId: { in: ids }, status: "OVERDUE" },
      orderBy: { dueDate: "asc" },
      select: {
        id: true, clientId: true, description: true, amount: true,
        paidTotal: true, dueDate: true, serviceId: true,
      },
    }),
    prisma.service.findMany({ select: { id: true, name: true } }),
  ]);

  const serviceName = new Map(services.map((s) => [s.id, s.name]));

  // agregações por cliente
  const attemptsBy = new Map<string, number>();
  const promiseBy = new Map<string, { at: Date | null; broken: boolean }>();
  const contactedTodayBy = new Set<string>();
  for (const h of histories) {
    if (!h.clientId) continue;
    attemptsBy.set(h.clientId, (attemptsBy.get(h.clientId) ?? 0) + 1);
    if (h.contactedAt >= today) contactedTodayBy.add(h.clientId);
    if (h.status === "PROMISED" && !promiseBy.has(h.clientId)) {
      promiseBy.set(h.clientId, {
        at: h.nextActionAt,
        broken: h.nextActionAt != null && h.nextActionAt < today,
      });
    }
  }

  const in30 = new Date();
  in30.setDate(in30.getDate() + 30);
  const recurringBy = new Set<string>();
  const renewalBy = new Set<string>();
  for (const c of contracts) {
    if (c.recurrence !== "NONE") recurringBy.add(c.clientId);
    if (c.renewalDate && c.renewalDate <= in30) renewalBy.add(c.clientId);
  }

  let receita90Total = 0;
  const receita90By = new Map<string, number>();
  for (const p of payments90) {
    const v = Number(p.amount);
    receita90Total += v;
    receita90By.set(p.billing.clientId, (receita90By.get(p.billing.clientId) ?? 0) + v);
  }

  const anchorBy = new Map<string, (typeof oldestBillings)[number]>();
  for (const b of oldestBillings) {
    if (!anchorBy.has(b.clientId)) anchorBy.set(b.clientId, b);
  }

  const items: CollectionQueueItem[] = [];
  for (const d of delinquents) {
    const anchor = anchorBy.get(d.clientId);
    if (!anchor) continue; // sem cobrança aberta (pagou entre as queries)

    const attempts = attemptsBy.get(d.clientId) ?? 0;
    const promise = promiseBy.get(d.clientId) ?? null;
    const recurring = recurringBy.has(d.clientId);
    const renewalSoon = renewalBy.has(d.clientId);
    const share = receita90Total > 0 ? (receita90By.get(d.clientId) ?? 0) / receita90Total : 0;
    const keyAccount = share >= KEY_ACCOUNT_REVENUE_SHARE;

    let score = 0;
    const reasons: string[] = [];
    // dias de atraso
    const agingScore = d.daysOverdue > 60 ? 30 : d.daysOverdue > 30 ? 22 : d.daysOverdue > 15 ? 15 : 8;
    score += agingScore;
    reasons.push(`${d.daysOverdue} dia(s) de atraso`);
    // valor
    const v = d.totalOverdue;
    const valueScore = v > 5000 ? 25 : v > 2000 ? 18 : v > 1000 ? 12 : v > 500 ? 8 : 4;
    score += valueScore;
    if (v > 1000) reasons.push("valor alto em aberto");
    // relacionamento
    if (recurring) { score += 10; reasons.push("cliente recorrente (MRR em risco)"); }
    if (renewalSoon) { score += 10; reasons.push("contrato renova em até 30 dias"); }
    if (keyAccount) { score += 10; reasons.push(`cliente-chave (${Math.round(share * 100)}% da receita 90d)`); }
    // histórico
    if (d.billingCount >= 3) { score += 8; reasons.push(`${d.billingCount} cobranças vencidas`); }
    if (attempts >= 3) { score += 8; reasons.push(`${attempts} tentativas de contato`); }
    if (promise?.broken) { score += 12; reasons.push("promessa de pagamento não cumprida"); }

    const priority: QueuePriority = score >= 60 ? "alta" : score >= 35 ? "media" : "baixa";

    // tom sugerido (do mais grave para o mais leve)
    let suggestedTone: MessageTone;
    if (d.daysOverdue > 60 || attempts >= 4) suggestedTone = "ultima_tentativa";
    else if (promise?.broken || d.daysOverdue > 30) suggestedTone = "urgente";
    else if (d.daysOverdue > 15) suggestedTone = "direto";
    else if (recurring) suggestedTone = "amigavel";
    else suggestedTone = "formal";

    items.push({
      clientId: d.clientId,
      clientName: d.clientName,
      phone: d.phone,
      totalOverdue: d.totalOverdue,
      daysOverdue: d.daysOverdue,
      billingCount: d.billingCount,
      attempts,
      lastContactAt: d.lastContactAt,
      lastContactStatus: d.lastContactStatus,
      promise,
      recurring,
      renewalSoon,
      keyAccount,
      score,
      priority,
      reasons,
      suggestedTone,
      contactedToday: contactedTodayBy.has(d.clientId),
      anchorBilling: {
        id: anchor.id,
        description: anchor.description,
        openAmount: Number(anchor.amount) - Number(anchor.paidTotal),
        dueDate: anchor.dueDate,
        serviceNames: anchor.serviceId
          ? [serviceName.get(anchor.serviceId) ?? ""].filter(Boolean)
          : [],
      },
    });
  }

  return items.sort((a, b) => b.score - a.score);
}
