import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import { requireAdmin } from "@/lib/auth/viewer";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import { getCashSummary } from "@/lib/services/finance-metrics";
import { getCollectionQueue } from "@/lib/services/collection-priority";
import { getRenewalOutlook } from "@/lib/services/revenue-metrics";
import { AISuggestionsPanel } from "./ai-suggestions";
import { MarkExpensePaid } from "./expense-actions";
import { DismissButton, ActionCheck, ExpenseDueDateDialog } from "./routine-controls";
import { MONTH_LABEL } from "@/app/clientes/_meta";
import { SavedViews } from "@/components/saved-views";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MessageDialog } from "@/app/cobrancas/message-dialog";
import { PaymentDialog } from "@/app/cobrancas/payment-dialog";
import type { MessageTone } from "@/lib/billing-message";
import { MessageSquareText, BadgeDollarSign, ExternalLink, ListChecks } from "lucide-react";

/**
 * ROTINA DIÁRIA — central de EXECUÇÃO do dia (a análise vive na Dashboard).
 * Estrutura: métricas do dia → Cobranças (a receber) → Pagamentos (a pagar)
 * → Ações de hoje (checklist) → Sugestões da IA (no final).
 *
 * Regras:
 *  - Cobranças = clientes vencidos (vermelho) + vencendo hoje/próximos 3 dias
 *    (amarelo). Fonte: Billing por competência (TCV nunca vira recorrente).
 *  - Pagamentos = despesas da empresa vencidas (vermelho) + hoje/3 dias (amarelo).
 *  - "Remover da rotina de hoje" só OCULTA o item do dia (RoutineItemState);
 *    nunca apaga nem altera cliente, cobrança, despesa ou status financeiro.
 *  - Checklist "Ações de hoje" persiste conclusões por dia.
 */

const PRIORITY_META: Record<string, { label: string; variant: any }> = {
  alta: { label: "Alta", variant: "destructive" },
  media: { label: "Média", variant: "warning" },
  baixa: { label: "Baixa", variant: "secondary" },
};

// Cores suaves das linhas (design system): vencido = vermelho discreto;
// vence hoje/3 dias = amarelo discreto.
const ROW_OVERDUE = "bg-red-50/70 dark:bg-red-500/[0.07]";
const ROW_SOON = "bg-warning-soft/60";

export default async function RotinaPage() {
  await requireAdmin();
  await markOverdueBillings();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in4 = new Date(today);
  in4.setDate(in4.getDate() + 4); // hoje + próximos 3 dias (limite exclusivo)
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // ---- Fase 1: fila de vencidos (agregador com várias queries internas) ----
  const queue = await getCollectionQueue();

  // ---- Fase 2: consultas leves do dia (uma leva só) ----
  const [accounts, dueSoonBillings, overdueExpenses, upcomingExpenses, states] =
    await Promise.all([
      prisma.account.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      // Cobranças que vencem hoje ou nos próximos 3 dias (a receber)
      prisma.billing.findMany({
        where: { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { gte: today, lt: in4 } },
        orderBy: [{ dueDate: "asc" }, { amount: "desc" }],
        select: {
          id: true, description: true, amount: true, paidTotal: true, dueDate: true,
          competenceMonth: true, competenceYear: true,
          client: { select: { id: true, name: true, phone: true } },
        },
      }),
      // Pagamentos vencidos (a pagar)
      prisma.transaction.findMany({
        where: { type: "despesa", status: { in: ["pendente", "devendo"] }, dueDate: { lt: today } },
        orderBy: { dueDate: "asc" },
        take: 25,
        select: { id: true, description: true, amount: true, dueDate: true, category: { select: { name: true } } },
      }),
      // Pagamentos que vencem hoje ou nos próximos 3 dias
      prisma.transaction.findMany({
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
      }),
      // Estado do dia: itens removidos da rotina + ações concluídas
      prisma.routineItemState.findMany({
        where: { routineDate: today },
        select: { itemType: true, itemKey: true, status: true },
      }),
    ]);

  // ---- Fase 3: contexto para o checklist ----
  const [cash, renewalWindows, openUpsells] = await Promise.all([
    getCashSummary(resolvePeriod({ periodo: "mes" })),
    getRenewalOutlook([0]),
    prisma.upsell.findMany({
      where: { status: { in: ["OPPORTUNITY", "NEGOTIATION"] } },
      orderBy: { value: "desc" },
      take: 3,
      select: { id: true, value: true, responsible: true, client: { select: { name: true } } },
    }),
  ]);

  const n = (v: unknown) => (v == null ? 0 : Number(v));
  const removed = new Set(
    states.filter((s) => s.status === "removed").map((s) => `${s.itemType}:${s.itemKey}`)
  );
  const doneActions = new Set(
    states.filter((s) => s.itemType === "acao" && s.status === "done").map((s) => s.itemKey)
  );
  const daysUntil = (d: Date) => Math.round((d.getTime() - today.getTime()) / 86400000);
  const mesRef = (m: number, y: number) => `${MONTH_LABEL[m] ?? m}/${y}`;

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
  type PayRow = {
    id: string; description: string; category: string | null; amount: number;
    dueDate: Date | null; overdue: boolean; dias: number;
    priority: "alta" | "media" | "baixa";
  };
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
  type Acao = { key: string; priority: "alta" | "media" | "baixa"; text: string; href?: string };
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
  if (cash.projecao30 < 0) {
    acoes.push({
      key: "caixa-projecao", priority: "alta",
      text: "Antecipar recebíveis ou renegociar prazos — caixa projetado negativo em 30 dias",
      href: "/cobrancas",
    });
  }
  const renov = renewalWindows[0];
  if (renov && renov.count > 0) {
    acoes.push({
      key: `renovacoes:${renov.month}`, priority: "media",
      text: `Encaminhar ${renov.count} renovação(ões) do mês — ${formatBRL(renov.expectedTotal)} esperado`,
      href: `/clientes?mesRenovacao=${renov.month}`,
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

  // Tom padrão da mensagem por atraso (amigável → direta → urgente).
  const toneFor = (daysOverdue: number): MessageTone =>
    daysOverdue >= 15 ? "urgente" : daysOverdue > 0 ? "direto" : "amigavel";
  const ROUTINE_TONES: MessageTone[] = ["amigavel", "direto", "urgente"];

  return (
    <div>
      <PageHeader
        title="Rotina diária"
        description="Acompanhe cobranças, pagamentos e ações financeiras que precisam de atenção hoje."
      />

      <div className="mb-3">
        <SavedViews module="rotina" />
      </div>

      {/* ===== Métricas principais (hoje + próximos 3 dias) ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <StatCard
          href="#cobrancas"
          title="Cobranças vencidas"
          value={String(vencidosSorted.length)}
          intent={vencidosSorted.length > 0 ? "negative" : "positive"}
          hint={formatBRL(cobrVencidasTotal)}
        />
        <StatCard
          href="#cobrancas"
          title="Cobranças próximas"
          value={String(proximos.length)}
          intent={proximos.length > 0 ? "warning" : "default"}
          hint={`${formatBRL(cobrProximasTotal)} · hoje a 3 dias`}
        />
        <StatCard
          href="#pagamentos"
          title="Pagamentos vencidos"
          value={String(payVencidos.length)}
          intent={payVencidos.length > 0 ? "negative" : "positive"}
          hint={formatBRL(pagVencidosTotal)}
        />
        <StatCard
          href="#pagamentos"
          title="Pagamentos próximos"
          value={String(payProximos.length)}
          intent={payProximos.length > 0 ? "warning" : "default"}
          hint={`${formatBRL(pagProximosTotal)} · hoje a 3 dias`}
        />
        <StatCard
          href="#acoes"
          title="Ações pendentes"
          value={String(acoesPendentes)}
          intent={acoesPendentes > 0 ? "warning" : "positive"}
          hint={`${acoes.length - acoesPendentes} concluída(s) hoje`}
        />
      </div>

      {/* ===== COBRANÇAS ===== */}
      <h2 id="cobrancas" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2 scroll-mt-24">
        Cobranças
      </h2>
      <p className="text-xs text-muted-foreground mb-3 -mt-1">
        Valores a receber dos clientes — vencidos e vencendo até 3 dias.
      </p>
      <Card className="mb-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Valor devido</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vencidosSorted.length === 0 && proximos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    Nenhuma cobrança precisando de atenção. 🎉
                  </TableCell>
                </TableRow>
              )}
              {vencidosSorted.map((q) => {
                const pm = PRIORITY_META[q.priority];
                return (
                  <TableRow key={q.clientId} className={ROW_OVERDUE}>
                    <TableCell>
                      <Link href={`/clientes/${q.clientId}`} className="font-medium hover:underline">
                        {q.clientName}
                      </Link>
                      <span className="block text-[11px] text-muted-foreground">
                        {q.billingCount} cobrança(s) em aberto
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium text-destructive">
                      {formatBRL(q.totalOverdue)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDateBR(q.anchorBilling.dueDate)}
                      <span className="block text-[11px] text-destructive">
                        venceu há {q.daysOverdue} dia(s)
                      </span>
                    </TableCell>
                    <TableCell><Badge variant="destructive">Vencido</Badge></TableCell>
                    <TableCell><Badge variant={pm.variant}>{pm.label}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <MessageDialog
                          phone={q.phone}
                          billingId={q.anchorBilling.id}
                          tones={ROUTINE_TONES}
                          defaultTone={toneFor(q.daysOverdue)}
                          input={{
                            clientName: q.clientName,
                            openAmount: formatBRL(q.totalOverdue),
                            dueDate: formatDateBR(q.anchorBilling.dueDate),
                            daysOverdue: q.daysOverdue,
                            serviceNames: q.anchorBilling.serviceNames,
                            hasPromise: !!q.promise,
                            contactCount: q.attempts,
                          }}
                          trigger={
                            <Button variant="ghost" size="icon" title="Gerar mensagem de cobrança">
                              <MessageSquareText className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <PaymentDialog
                          billing={{
                            id: q.anchorBilling.id,
                            openAmount: q.anchorBilling.openAmount,
                            description: q.anchorBilling.description,
                          }}
                          accounts={accounts}
                          trigger={
                            <Button variant="ghost" size="icon" title="Registrar pagamento">
                              <BadgeDollarSign className="h-4 w-4 text-emerald-600" />
                            </Button>
                          }
                        />
                        <DismissButton itemType="cobranca" itemKey={q.clientId} itemLabel={q.clientName} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {proximos.map(({ b, open, dias, priority }) => {
                const pm = PRIORITY_META[priority];
                return (
                  <TableRow key={b.id} className={ROW_SOON}>
                    <TableCell>
                      <Link href={`/clientes/${b.client.id}`} className="font-medium hover:underline">
                        {b.client.name}
                      </Link>
                      <span className="block text-[11px] text-muted-foreground max-w-[220px] truncate">
                        {b.description}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatBRL(open)}</TableCell>
                    <TableCell className="text-sm">
                      {formatDateBR(b.dueDate)}
                      <span className="block text-[11px] text-warning">
                        {dias === 0 ? "vence hoje" : dias === 1 ? "vence amanhã" : `vence em ${dias} dias`}
                      </span>
                    </TableCell>
                    <TableCell><Badge variant="warning">Em aberto</Badge></TableCell>
                    <TableCell><Badge variant={pm.variant}>{pm.label}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <MessageDialog
                          phone={b.client.phone}
                          billingId={b.id}
                          tones={ROUTINE_TONES}
                          defaultTone="amigavel"
                          input={{
                            clientName: b.client.name,
                            openAmount: formatBRL(open),
                            dueDate: formatDateBR(b.dueDate),
                            daysOverdue: 0,
                            serviceNames: [],
                            hasPromise: false,
                            contactCount: 0,
                            referenceMonth: mesRef(b.competenceMonth, b.competenceYear),
                          }}
                          trigger={
                            <Button variant="ghost" size="icon" title="Gerar mensagem de cobrança">
                              <MessageSquareText className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <PaymentDialog
                          billing={{ id: b.id, openAmount: open, description: b.description }}
                          accounts={accounts}
                          trigger={
                            <Button variant="ghost" size="icon" title="Registrar pagamento">
                              <BadgeDollarSign className="h-4 w-4 text-emerald-600" />
                            </Button>
                          }
                        />
                        <DismissButton itemType="cobranca" itemKey={b.client.id} itemLabel={b.client.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ===== PAGAMENTOS ===== */}
      <h2 id="pagamentos" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2 scroll-mt-24">
        Pagamentos
      </h2>
      <p className="text-xs text-muted-foreground mb-3 -mt-1">
        Valores que a agência precisa pagar — despesas vencidas e vencendo até 3 dias.
      </p>
      <Card className="mb-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Despesa</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Prioridade</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payVencidos.length === 0 && payProximos.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    Nenhum pagamento precisando de atenção. 🎉
                  </TableCell>
                </TableRow>
              )}
              {[...payVencidos, ...payProximos].map((p) => {
                const pm = PRIORITY_META[p.priority];
                return (
                  <TableRow key={p.id} className={p.overdue ? ROW_OVERDUE : ROW_SOON}>
                    <TableCell className="font-medium max-w-[240px] truncate">{p.description}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.category ?? "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${p.overdue ? "text-destructive" : ""}`}>
                      {formatBRL(p.amount)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.dueDate ? formatDateBR(p.dueDate) : "hoje"}
                      <span className={`block text-[11px] ${p.overdue ? "text-destructive" : "text-warning"}`}>
                        {p.overdue
                          ? `vencido há ${p.dias} dia(s)`
                          : p.dias === 0 ? "vence hoje" : p.dias === 1 ? "vence amanhã" : `vence em ${p.dias} dias`}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.overdue ? "destructive" : "warning"}>
                        {p.overdue ? "Vencido" : "Pendente"}
                      </Badge>
                    </TableCell>
                    <TableCell><Badge variant={pm.variant}>{pm.label}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end items-center">
                        <MarkExpensePaid id={p.id} />
                        <ExpenseDueDateDialog
                          expenseId={p.id}
                          description={p.description}
                          currentDue={p.dueDate ? iso(p.dueDate) : iso(today)}
                        />
                        <Button variant="ghost" size="icon" asChild title="Ver despesa">
                          <Link href="/despesas">
                            <ExternalLink className="h-4 w-4 text-muted-foreground" />
                          </Link>
                        </Button>
                        <DismissButton itemType="pagamento" itemKey={p.id} itemLabel={p.description} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ===== AÇÕES DE HOJE ===== */}
      <h2 id="acoes" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2 scroll-mt-24">
        Ações de hoje
      </h2>
      <Card className="mb-6">
        <CardContent className="p-5">
          {acoes.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nada urgente hoje. Dia tranquilo! 🎉
            </p>
          ) : (
            <ul className="space-y-2.5">
              {acoes.map((a) => {
                const pm = PRIORITY_META[a.priority];
                const done = doneActions.has(a.key);
                return (
                  <li key={a.key} className="flex items-start gap-2">
                    <ActionCheck itemKey={a.key} done={done}>
                      <span className="inline-flex items-start gap-2">
                        <Badge variant={done ? "outline" : pm.variant} className="shrink-0 mt-0.5 text-[10px] px-1.5">
                          {pm.label}
                        </Badge>
                        {a.href ? (
                          <Link href={a.href} className={done ? "" : "hover:underline"}>
                            {a.text}
                          </Link>
                        ) : (
                          a.text
                        )}
                      </span>
                    </ActionCheck>
                  </li>
                );
              })}
            </ul>
          )}
          {acoes.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-4 flex items-center gap-1.5">
              <ListChecks className="h-3.5 w-3.5" />
              {acoesPendentes} pendente(s) · {acoes.length - acoesPendentes} concluída(s) — o checklist zera a cada dia.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ===== Sugestões inteligentes (IA) — no final ===== */}
      <AISuggestionsPanel />
    </div>
  );
}
