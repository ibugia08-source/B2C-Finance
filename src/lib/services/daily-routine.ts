import { BILLING_AWAITING_STATUSES } from "@/lib/billing-status";
import { prisma } from "@/lib/prisma";
import { formatBRL } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import { getCashSummary } from "@/lib/services/finance-metrics";
import { getCollectionQueue } from "@/lib/services/collection-priority";
import { getRenewalOutlook } from "@/lib/services/revenue-metrics";
import { type DomainContext, domainCan, inDomain } from "@/lib/engines/domain";

/**
 * ROTINA DIÁRIA — regra de domínio (extraída de app/rotina/page.tsx em
 * 27/09/2026, sem mudança de comportamento). O que cobrar hoje (vencidos +
 * hoje/3 dias), o que pagar (vencidas + hoje/3 dias), prioridades e o
 * checklist "Ações de hoje". A página renderiza o resultado; a futura API
 * devolve o mesmo resultado.
 *
 * SÓ LEITURA: marcar cobranças vencidas (`markOverdueBillings`) é escrita e
 * continua com quem chama (a página faz antes de montar, como antes).
 * Cada seção só busca dados se o principal tiver acesso ao módulo de origem.
 */

export type RoutinePriority = "alta" | "media" | "baixa";

export type PayRow = {
  id: string; description: string; category: string | null; amount: number;
  dueDate: Date | null; overdue: boolean; dias: number;
  priority: RoutinePriority;
};

export type Acao = { key: string; priority: RoutinePriority; text: string; href?: string };

/** O que cada perfil vê e pode fazer na rotina (RBAC existente). */
export function gatesDaRotina(ctx: DomainContext) {
  return {
    cobrancas: domainCan(ctx, "recebimentos.visualizar"),
    pagamentos: domainCan(ctx, "despesas.visualizar"),
    caixa: domainCan(ctx, "caixa.visualizar"),
    renovacoes: domainCan(ctx, "clientes.visualizar"),
    upsell: domainCan(ctx, "upsell.visualizar"),
    ia: domainCan(ctx, "dashboard.ver_financeiro"),
    gerarCobranca: domainCan(ctx, "recebimentos.gerar_cobranca"),
    registrarPagamento: domainCan(ctx, "recebimentos.registrar_pagamento"),
    marcarPaga: domainCan(ctx, "despesas.marcar_como_paga"),
    alterarVencimento: domainCan(ctx, "despesas.editar"),
    concluirAcao: domainCan(ctx, "rotina.concluir_acao"),
  };
}
export type RoutineGates = ReturnType<typeof gatesDaRotina>;

/** Monta a rotina do dia (sem gravar nada). */
export async function montarRotinaDoDia(ctx: DomainContext) {
  const gates = gatesDaRotina(ctx);
  return inDomain(ctx, async () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const in4 = new Date(today);
    in4.setDate(in4.getDate() + 4); // hoje + próximos 3 dias (limite exclusivo)
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // ---- Fase 1: fila de vencidos (agregador com várias queries internas) ----
    const queue = gates.cobrancas ? await getCollectionQueue() : [];

    // ---- Fase 2: consultas leves do dia (uma leva só) ----
    const [accounts, dueSoonBillings, overdueExpenses, upcomingExpenses, states] =
      await Promise.all([
        // Contas: usadas apenas pelo diálogo de registrar pagamento
        gates.cobrancas && gates.registrarPagamento
          ? prisma.account.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
          : [],
        // Cobranças que vencem hoje ou nos próximos 3 dias (a receber)
        gates.cobrancas
          ? prisma.billing.findMany({
              where: { status: { in: [...BILLING_AWAITING_STATUSES] }, dueDate: { gte: today, lt: in4 } },
              orderBy: [{ dueDate: "asc" }, { amount: "desc" }],
              select: {
                id: true, description: true, amount: true, paidTotal: true, dueDate: true,
                competenceMonth: true, competenceYear: true,
                client: { select: { id: true, name: true, phone: true } },
              },
            })
          : [],
        // Pagamentos vencidos (a pagar)
        gates.pagamentos
          ? prisma.transaction.findMany({
              where: { type: "despesa", status: { in: ["pendente", "devendo"] }, dueDate: { lt: today } },
              orderBy: { dueDate: "asc" },
              take: 25,
              select: { id: true, description: true, amount: true, dueDate: true, category: { select: { name: true } } },
            })
          : [],
        // Pagamentos que vencem hoje ou nos próximos 3 dias
        gates.pagamentos
          ? prisma.transaction.findMany({
              where: {
                type: "despesa", status: { in: ["pendente", "devendo"] },
                OR: [
                  { dueDate: { gte: today, lt: in4 } },
                  { dueDate: null, date: { gte: today, lt: tomorrow } },
                ],
              },
              orderBy: [{ dueDate: "asc" }, { amount: "desc" }],
              take: 25,
              select: { id: true, description: true, amount: true, dueDate: true, date: true, category: { select: { name: true } } },
            })
          : [],
        // Estado do dia: itens removidos da rotina + ações concluídas
        prisma.routineItemState.findMany({
          where: { routineDate: today },
          select: { itemType: true, itemKey: true, status: true },
        }),
      ]);

    // ---- Fase 3: contexto para o checklist ----
    const [cash, renewalWindows, openUpsells] = await Promise.all([
      gates.caixa ? getCashSummary(resolvePeriod({ periodo: "mes" })) : null,
      gates.renovacoes ? getRenewalOutlook([0]) : [],
      gates.upsell
        ? prisma.upsell.findMany({
            where: { status: { in: ["OPPORTUNITY", "NEGOTIATION"] } },
            orderBy: { value: "desc" },
            take: 3,
            select: { id: true, value: true, responsible: true, client: { select: { name: true } } },
          })
        : [],
    ]);

    const n = (v: unknown) => (v == null ? 0 : Number(v));
    const removed = new Set(
      states.filter((s) => s.status === "removed").map((s) => `${s.itemType}:${s.itemKey}`)
    );
    const doneActions = new Set(
      states.filter((s) => s.itemType === "acao" && s.status === "done").map((s) => s.itemKey)
    );
    const daysUntil = (d: Date) => Math.round((d.getTime() - today.getTime()) / 86400000);

    // ===== COBRANÇAS (a receber) — vencidos + hoje/3 dias =====
    const vencidos = queue.filter((q) => !removed.has(`cobranca:${q.clientId}`));
    const queueIds = new Set(queue.map((q) => q.clientId));
    const proximos = dueSoonBillings
      .filter((b) => !removed.has(`cobranca:${b.client.id}`) && !queueIds.has(b.client.id))
      .map((b) => {
        const open = n(b.amount) - n(b.paidTotal);
        const dias = daysUntil(b.dueDate);
        // Prioridade: hoje/amanhã = Média · 2-3 dias = Baixa · valor alto sobe 1 nível
        let priority: "alta" | "media" | "baixa" = dias <= 1 ? "media" : "baixa";
        if (open >= 5000) priority = priority === "media" ? "alta" : "media";
        return { b, open, dias, priority };
      })
      .filter((x) => x.open > 0);
    // Ordenação: vencidos há mais tempo → recentes (a fila já vem por score;
    // reordenamos por atraso) → vence hoje → próximos 3 dias.
    const vencidosSorted = [...vencidos].sort((a, b) => b.daysOverdue - a.daysOverdue);

    const cobrVencidasTotal = vencidosSorted.reduce((s, q) => s + q.totalOverdue, 0);
    const cobrProximasTotal = proximos.reduce((s, x) => s + x.open, 0);

    // ===== PAGAMENTOS (a pagar) — vencidos + hoje/3 dias =====
    const payPriority = (overdue: boolean, dias: number, amount: number, label: string): PayRow["priority"] => {
      const critical = amount >= 3000 || /imposto|folha|das\b|fgts|inss/i.test(label);
      if (overdue) return "alta";
      if (dias <= 1) return critical ? "alta" : "media";
      return critical ? "media" : "baixa";
    };
    const payVencidos: PayRow[] = overdueExpenses
      .filter((e) => !removed.has(`pagamento:${e.id}`))
      .map((e) => ({
        id: e.id, description: e.description, category: e.category?.name ?? null,
        amount: n(e.amount), dueDate: e.dueDate, overdue: true,
        dias: e.dueDate ? Math.abs(daysUntil(e.dueDate)) : 0,
        priority: payPriority(true, 0, n(e.amount), `${e.description} ${e.category?.name ?? ""}`),
      }))
      .sort((a, b) => b.dias - a.dias);
    const payProximos: PayRow[] = upcomingExpenses
      .filter((e) => !removed.has(`pagamento:${e.id}`))
      .map((e) => {
        const due = e.dueDate ?? e.date;
        const dias = Math.max(0, daysUntil(due));
        return {
          id: e.id, description: e.description, category: e.category?.name ?? null,
          amount: n(e.amount), dueDate: e.dueDate, overdue: false, dias,
          priority: payPriority(false, dias, n(e.amount), `${e.description} ${e.category?.name ?? ""}`),
        };
      })
      .sort((a, b) => a.dias - b.dias || b.amount - a.amount);

    const pagVencidosTotal = payVencidos.reduce((s, p) => s + p.amount, 0);
    const pagProximosTotal = payProximos.reduce((s, p) => s + p.amount, 0);

    // ===== AÇÕES DE HOJE (checklist com chaves estáveis por dia) =====
    const acoes: Acao[] = [];
    for (const q of vencidosSorted.filter((x) => x.priority === "alta").slice(0, 3)) {
      acoes.push({
        key: `cobrar:${q.clientId}`, priority: "alta",
        text: `Cobrar ${q.clientName} — ${formatBRL(q.totalOverdue)} vencidos há ${q.daysOverdue} dia(s)`,
        href: "#cobrancas",
      });
    }
    for (const p of vencidosSorted.filter((x) => x.promise?.broken).slice(0, 2)) {
      acoes.push({
        key: `promessa:${p.clientId}`, priority: "alta",
        text: `Retomar contato com ${p.clientName} — promessa de pagamento vencida`,
        href: "#cobrancas",
      });
    }
    if (payVencidos.length > 0) {
      acoes.push({
        key: "despesas-vencidas", priority: "alta",
        text: `Resolver ${payVencidos.length} pagamento(s) vencido(s) — ${formatBRL(pagVencidosTotal)}`,
        href: "#pagamentos",
      });
    }
    const pagHoje = payProximos.filter((p) => p.dias === 0);
    if (pagHoje.length > 0) {
      acoes.push({
        key: "pagar-hoje", priority: "media",
        text: `Pagar ${pagHoje.length} despesa(s) que vencem hoje — ${formatBRL(pagHoje.reduce((s, p) => s + p.amount, 0))}`,
        href: "#pagamentos",
      });
    }
    const cobrHoje = proximos.filter((x) => x.dias === 0);
    if (cobrHoje.length > 0) {
      acoes.push({
        key: "cobrancas-hoje", priority: "media",
        text: `Acompanhar ${cobrHoje.length} cobrança(s) que vencem hoje — ${formatBRL(cobrHoje.reduce((s, x) => s + x.open, 0))}`,
        href: "#cobrancas",
      });
    }
    if (cash && cash.projecao30 < 0) {
      acoes.push({
        key: "caixa-projecao", priority: "alta",
        text: "Antecipar recebíveis ou renegociar prazos — caixa projetado negativo em 30 dias",
        href: "/cobrancas",
      });
    }
    // Só o que ainda está PENDENTE: quem já renovou ou já foi dado como perdido
    // não tem mais o que encaminhar (antes a ação somava o livro inteiro).
    const renov = renewalWindows[0];
    const renovPendentes = renov ? renov.clients.filter((c) => c.outcome === "pendente") : [];
    const renovPendenteValor =
      Math.round(renovPendentes.reduce((s, c) => s + c.expected, 0) * 100) / 100;
    if (renov && renovPendentes.length > 0) {
      acoes.push({
        key: `renovacoes:${renov.month}`, priority: "media",
        text: `Encaminhar ${renovPendentes.length} renovação(ões) pendente(s) do mês — ${formatBRL(renovPendenteValor)} esperado`,
        href: "/renovacoes",
      });
    }
    for (const u of openUpsells.slice(0, 2)) {
      acoes.push({
        key: `upsell:${u.id}`, priority: "baixa",
        text: `Avançar upsell de ${u.client.name} — ${formatBRL(Number(u.value))}${u.responsible ? ` (${u.responsible})` : ""}`,
        href: "/upsell",
      });
    }
    const ORDER = { alta: 0, media: 1, baixa: 2 } as const;
    acoes.sort((a, b) => {
      const da = doneActions.has(a.key) ? 1 : 0;
      const db = doneActions.has(b.key) ? 1 : 0;
      return da - db || ORDER[a.priority] - ORDER[b.priority];
    });
    const acoesPendentes = acoes.filter((a) => !doneActions.has(a.key)).length;
    return {
      today,
      in4,
      tomorrow,
      queue,
      accounts,
      dueSoonBillings,
      overdueExpenses,
      upcomingExpenses,
      states,
      cash,
      renewalWindows,
      openUpsells,
      n,
      removed,
      doneActions,
      daysUntil,
      vencidos,
      queueIds,
      proximos,
      vencidosSorted,
      cobrVencidasTotal,
      cobrProximasTotal,
      payPriority,
      payVencidos,
      payProximos,
      pagVencidosTotal,
      pagProximosTotal,
      acoes,
      pagHoje,
      cobrHoje,
      renov,
      renovPendentes,
      renovPendenteValor,
      ORDER,
      acoesPendentes,
    };
  });
}
