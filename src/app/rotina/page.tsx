import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR } from "@/lib/format";
import { resolvePeriod } from "@/lib/period";
import { requireAdmin } from "@/lib/auth/viewer";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import { getCashSummary, getFinanceSummary } from "@/lib/services/finance-metrics";
import { getCollectionQueue } from "@/lib/services/collection-priority";
import { getRenewalOutlook, getReceiptsSummary, getPeriodRevenue } from "@/lib/services/revenue-metrics";
import { getMonthlySeries } from "@/lib/services/dashboard-metrics";
import { limitesUsadosPorCartao } from "@/lib/services/calculations";
import { AISuggestionsPanel } from "./ai-suggestions";
import { MarkExpensePaid } from "./expense-actions";
import { MONTH_LABEL } from "@/app/clientes/_meta";
import { SavedViews } from "@/components/saved-views";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { MessageDialog } from "@/app/cobrancas/message-dialog";
import { NoteDialog } from "@/app/cobrancas/note-dialog";
import { PaymentDialog } from "@/app/cobrancas/payment-dialog";
import {
  MessageSquareText, Handshake, BadgeDollarSign, NotebookPen,
  AlertTriangle, CheckCircle2, ArrowRight, Star, Repeat2, ExternalLink,
} from "lucide-react";

/**
 * ROTINA DIÁRIA — central de AÇÕES do dia (não é uma segunda Dashboard).
 * Estrutura: resumo rápido (4 métricas operacionais) → alertas → IA →
 * 1. Cobranças de hoje · 2. Clientes vencidos · 3. Despesas ·
 * 4. Alertas · 5. Oportunidades — tudo com ação rápida na própria tela.
 *
 * Regras financeiras (camada central, MESMAS fórmulas do Dashboard):
 *  - Falta receber = previsto do mês − recebido do mês (getReceiptsSummary.openMonth)
 *  - Vencido = parte do falta receber já vencida (overdueOpenAmount ⊂ openMonth)
 *  - MRR/TCV via cobranças (Billing) por competência: TCV só tem cobrança no
 *    mês do fechamento/renovação — nunca aparece como recorrente mensal.
 */

const PRIORITY_META: Record<string, { label: string; variant: any }> = {
  alta: { label: "Alta", variant: "destructive" },
  media: { label: "Média", variant: "warning" },
  baixa: { label: "Baixa", variant: "secondary" },
};

const REVENUE_TYPE_LABEL: Record<string, string> = {
  MRR: "MRR",
  TCV: "TCV",
  SETUP: "Setup",
  ONE_TIME: "Avulsa",
  RECOVERY: "Recuperação",
  OTHER: "Outra",
};

export default async function RotinaPage() {
  await requireAdmin();
  await markOverdueBillings();

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const in7 = new Date(today);
  in7.setDate(in7.getDate() + 7);
  const in30 = new Date(today);
  in30.setDate(in30.getDate() + 30);
  const period = resolvePeriod({ periodo: "mes" });

  const [
    queue, cash, accounts, dueToday, payToday, criticalExpenses, weekExpenses,
    receiptsMes, revenue, renewals, renewalWindows, finance, series, openUpsells, cardsAll,
  ] = await Promise.all([
    getCollectionQueue(),
    getCashSummary(period),
    prisma.account.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // Bloco 1 — cobranças que VENCEM HOJE (Billing = respeita MRR/TCV por
    // competência: TCV só existe como cobrança no mês do fechamento).
    prisma.billing.findMany({
      where: { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { gte: today, lt: tomorrow } },
      orderBy: { amount: "desc" },
      select: {
        id: true, description: true, amount: true, paidTotal: true, dueDate: true,
        revenueType: true, status: true, competenceMonth: true, competenceYear: true,
        client: { select: { id: true, name: true, phone: true } },
      },
    }),
    prisma.transaction.findMany({
      where: {
        type: "despesa", status: { in: ["pendente", "devendo"] },
        OR: [{ dueDate: { gte: today, lt: tomorrow } }, { dueDate: null, date: { gte: today, lt: tomorrow } }],
      },
      orderBy: { amount: "desc" },
      select: { id: true, description: true, amount: true },
    }),
    prisma.transaction.findMany({
      where: { type: "despesa", status: { in: ["pendente", "devendo"] }, dueDate: { lt: today } },
      orderBy: { dueDate: "asc" },
      take: 10,
      select: { id: true, description: true, amount: true, dueDate: true },
    }),
    prisma.transaction.findMany({
      where: { type: "despesa", status: { in: ["pendente", "devendo"] }, dueDate: { gte: tomorrow, lt: in7 } },
      orderBy: { dueDate: "asc" },
      take: 10,
      select: { id: true, description: true, amount: true, dueDate: true },
    }),
    // Métricas OFICIAIS do mês vigente — mesma função/fórmula do Dashboard.
    // Falta receber = previsto − recebido; nunca soma inadimplência antiga
    // (essa vive na fila de vencidos, seção própria).
    getReceiptsSummary(period.start, period.end),
    // Faturamento previsto do mês (MRR + TCV) — MESMA fonte do Dashboard.
    getPeriodRevenue(period.start, period.end),
    prisma.contract.findMany({
      where: { status: { in: ["ACTIVE", "RENEWAL"] }, renewalDate: { not: null, lte: in30 } },
      orderBy: { renewalDate: "asc" },
      take: 6,
      select: { id: true, title: true, renewalDate: true, client: { select: { name: true } } },
    }),
    getRenewalOutlook([0, 1]),
    getFinanceSummary(resolvePeriod({ periodo: "mes" })),
    getMonthlySeries({ period: resolvePeriod({ periodo: "mes" }) }),
    prisma.upsell.findMany({
      where: { status: { in: ["OPPORTUNITY", "NEGOTIATION"] } },
      orderBy: { value: "desc" },
      take: 5,
      select: { id: true, title: true, value: true, responsible: true, client: { select: { name: true } } },
    }),
    prisma.creditCard.findMany({
      where: { active: true },
      select: { id: true, name: true, limitTotal: true, dueDay: true },
    }),
  ]);

  // Responsável comercial dos clientes da fila de vencidos (Bloco 2).
  const ownerByClient = new Map<string, string | null>(
    queue.length
      ? (
          await prisma.client.findMany({
            where: { id: { in: queue.map((q) => q.clientId) } },
            select: { id: true, salesOwner: true },
          })
        ).map((c) => [c.id, c.salesOwner])
      : []
  );

  const n = (v: unknown) => (v == null ? 0 : Number(v));

  // ===== Resumo rápido (métricas operacionais — nomenclatura única §18) =====
  // Falta receber = FÓRMULA IDÊNTICA ao card "Em Aberto" do Dashboard:
  // max(0, previsto (MRR+TCV via getPeriodRevenue) − recebido do mês).
  const faltaReceber = Math.max(0, revenue.total - receiptsMes.receiptsCorrectMonth);
  const vencidoMes = receiptsMes.overdueOpenAmount; // ⊂ falta receber (mesma fonte do Dashboard)
  const totalPagarHoje = payToday.reduce((s, t) => s + n(t.amount), 0);
  const totalCritico = criticalExpenses.reduce((s, t) => s + n(t.amount), 0);
  const cobrarHoje = queue.filter((q) => !q.contactedToday);

  // ===== Cartões: vencimento próximo (5 dias) e limite preocupante (>80%) =====
  const usedByCard = await limitesUsadosPorCartao(cardsAll.map((c) => c.id));
  const dayOfMonth = new Date().getDate();
  const cardWarnings: { text: string; critical: boolean }[] = [];
  for (const c of cardsAll) {
    const daysToDue = (c.dueDay - dayOfMonth + 31) % 31;
    if (daysToDue <= 5) {
      cardWarnings.push({
        text: `${c.name}: fatura vence dia ${c.dueDay} (${daysToDue === 0 ? "hoje" : `em ${daysToDue}d`})`,
        critical: daysToDue <= 1,
      });
    }
    const used = usedByCard.get(c.id) ?? 0;
    if (c.limitTotal > 0 && used / c.limitTotal >= 0.8) {
      cardWarnings.push({
        text: `${c.name}: ${Math.round((used / c.limitTotal) * 100)}% do limite usado (${formatBRL(used)} de ${formatBRL(c.limitTotal)})`,
        critical: used / c.limitTotal >= 0.95,
      });
    }
  }

  // ===== Bloco 4 — Alertas (o que está acontecendo · por que importa) =====
  const last = (arr: number[]) => arr[arr.length - 1] ?? 0;
  const prev = (arr: number[]) => arr[arr.length - 2] ?? 0;
  const trendAlerts: { text: string; critical: boolean }[] = [];
  if (vencidoMes > 0 && revenue.total > 0 && vencidoMes / revenue.total >= 0.25) {
    trendAlerts.push({
      text: `Vencido alto: ${formatBRL(vencidoMes)} (${Math.round((vencidoMes / revenue.total) * 100)}% do previsto do mês) — priorize a fila de cobrança.`,
      critical: vencidoMes / revenue.total >= 0.4,
    });
  }
  if (prev(series.mrr) > 0 && last(series.mrr) < prev(series.mrr)) {
    trendAlerts.push({
      text: `Queda de MRR: ${formatBRL(last(series.mrr) - prev(series.mrr))} vs mês anterior.`,
      critical: last(series.mrr) < prev(series.mrr) * 0.9,
    });
  }
  if (prev(series.receitas) > 0 && last(series.receitas) < prev(series.receitas) * 0.85) {
    trendAlerts.push({
      text: `Queda de faturamento: ${formatBRL(last(series.receitas))} vs ${formatBRL(prev(series.receitas))} no mês anterior.`,
      critical: true,
    });
  }
  if (prev(series.despesas) > 0 && last(series.despesas) > prev(series.despesas) * 1.2) {
    trendAlerts.push({
      text: `Alta de despesas: ${formatBRL(last(series.despesas))} (+${Math.round((last(series.despesas) / prev(series.despesas) - 1) * 100)}% vs mês anterior).`,
      critical: false,
    });
  }
  if (finance.receitas > 0 && finance.margem < 0.2) {
    trendAlerts.push({
      text: `Margem do mês em ${Math.round(finance.margem * 100)}% — abaixo do saudável (20%+).`,
      critical: finance.margem < 0,
    });
  }
  const cashAlerts: string[] = [];
  if (cash.caixaDisponivel <= 0) cashAlerts.push(`Caixa disponível zerado/negativo (${formatBRL(cash.caixaDisponivel)}).`);
  if (cash.projecao30 < 0) cashAlerts.push(`Projeção de caixa NEGATIVA em 30 dias (${formatBRL(cash.projecao30)}).`);
  const pagarSemana = totalPagarHoje + totalCritico + weekExpenses.reduce((s, t) => s + n(t.amount), 0);
  if (pagarSemana > cash.caixaDisponivel && cash.caixaDisponivel > 0)
    cashAlerts.push(`Compromissos da semana (${formatBRL(pagarSemana)}) maiores que o caixa (${formatBRL(cash.caixaDisponivel)}).`);

  const renewalsThisMonth = renewalWindows[0];
  const renewalsNextMonth = renewalWindows[1];
  const promessas = queue.filter((q) => q.promise);

  // ===== Ações pendentes COM PRIORIDADE (valor × atraso × impacto §8) =====
  type Tarefa = { priority: "alta" | "media" | "baixa"; text: string; href: string };
  const tarefas: Tarefa[] = [];
  for (const q of cobrarHoje.filter((x) => x.priority === "alta").slice(0, 3)) {
    tarefas.push({ priority: "alta", text: `Cobrar ${q.clientName} — ${formatBRL(q.totalOverdue)} vencidos há ${q.daysOverdue} dia(s)`, href: "#vencidos" });
  }
  if (cash.projecao30 < 0)
    tarefas.push({ priority: "alta", text: "Antecipar recebíveis ou renegociar prazos — caixa projetado negativo em 30 dias", href: "/cobrancas" });
  if (totalCritico > 0)
    tarefas.push({ priority: "alta", text: `Resolver ${criticalExpenses.length} despesa(s) vencida(s) — ${formatBRL(totalCritico)}`, href: "#despesas" });
  for (const p of promessas.filter((x) => x.promise?.broken).slice(0, 2)) {
    tarefas.push({ priority: "alta", text: `Retomar contato com ${p.clientName} — promessa de pagamento vencida`, href: "#vencidos" });
  }
  for (const b of dueToday.slice(0, 3)) {
    tarefas.push({
      priority: "media",
      text: `Registrar pagamento de ${b.client.name} — ${formatBRL(n(b.amount) - n(b.paidTotal))} vence hoje`,
      href: "#hoje",
    });
  }
  if (totalPagarHoje > 0)
    tarefas.push({ priority: "media", text: `Pagar ${payToday.length} despesa(s) de hoje — ${formatBRL(totalPagarHoje)}`, href: "#despesas" });
  if (renewalsThisMonth && renewalsThisMonth.count > 0)
    tarefas.push({
      priority: "media",
      text: `Encaminhar ${renewalsThisMonth.count} renovação(ões) do mês — ${formatBRL(renewalsThisMonth.expectedTotal)} esperado`,
      href: `/clientes?mesRenovacao=${renewalsThisMonth.month}`,
    });
  for (const w of cardWarnings.filter((c) => c.critical).slice(0, 2)) {
    tarefas.push({ priority: "media", text: w.text, href: "/despesas?aba=cartoes" });
  }
  for (const u of openUpsells.slice(0, 2)) {
    tarefas.push({
      priority: "baixa",
      text: `Avançar upsell de ${u.client.name} — ${formatBRL(Number(u.value))}${u.responsible ? ` (${u.responsible})` : ""}`,
      href: "/upsell",
    });
  }
  const ORDER = { alta: 0, media: 1, baixa: 2 } as const;
  tarefas.sort((a, b) => ORDER[a.priority] - ORDER[b.priority]);

  const mesRef = (m: number, y: number) => `${MONTH_LABEL[m] ?? m}/${y}`;

  return (
    <div>
      <PageHeader
        title="Rotina Diária"
        description={`Acompanhe as ações financeiras que precisam de atenção hoje · ${formatDateBR(new Date())}`}
      />

      <div className="mb-3">
        <SavedViews module="rotina" />
      </div>

      {/* ===== Resumo rápido — 4 métricas operacionais (§3/§18) ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard
          href="/cobrancas"
          title="Falta receber (mês)"
          value={formatBRL(faltaReceber)}
          hint="previsto do mês − recebido (= Em Aberto do Dashboard)"
        />
        <StatCard
          href="#vencidos"
          title="Vencido (mês)"
          value={formatBRL(vencidoMes)}
          intent={vencidoMes > 0 ? "negative" : "positive"}
          hint="parte do falta receber já vencida"
        />
        <StatCard
          href="#despesas"
          title="Despesas a pagar"
          value={formatBRL(totalPagarHoje + totalCritico)}
          intent={totalCritico > 0 ? "negative" : "default"}
          hint={totalCritico > 0 ? `${formatBRL(totalCritico)} já vencido!` : `${payToday.length} despesa(s) hoje`}
        />
        <StatCard
          href="#vencidos"
          title="Clientes para cobrar"
          value={String(queue.length)}
          intent={queue.length > 0 ? "negative" : "positive"}
          hint={`${cobrarHoje.length} ainda sem contato hoje`}
        />
      </div>

      {/* ===== Bloco 4 — Alertas importantes ===== */}
      {(cashAlerts.length > 0 || trendAlerts.length > 0 || cardWarnings.length > 0) && (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="p-4 space-y-1">
            {cashAlerts.map((a, i) => (
              <p key={`c${i}`} className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" /> {a}
              </p>
            ))}
            {trendAlerts.map((a, i) => (
              <p key={`t${i}`} className="text-sm flex items-center gap-2">
                <AlertTriangle className={`h-4 w-4 shrink-0 ${a.critical ? "text-red-500" : "text-amber-500"}`} />
                {a.text}
              </p>
            ))}
            {cardWarnings.map((a, i) => (
              <p key={`w${i}`} className="text-sm flex items-center gap-2">
                <AlertTriangle className={`h-4 w-4 shrink-0 ${a.critical ? "text-red-500" : "text-amber-500"}`} />
                {a.text}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mb-6">
        <AISuggestionsPanel />
      </div>

      {/* ===== Bloco 1 — Cobranças de hoje ===== */}
      <h2 id="hoje" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2 scroll-mt-24">
        Cobranças de hoje
      </h2>
      <Card className="mb-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Modalidade</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dueToday.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-10">
                    Nenhuma cobrança vence hoje.
                  </TableCell>
                </TableRow>
              )}
              {dueToday.map((b) => {
                const open = n(b.amount) - n(b.paidTotal);
                return (
                  <TableRow key={b.id}>
                    <TableCell>
                      <span className="font-medium">{b.client.name}</span>
                      <span className="block text-xs text-muted-foreground max-w-[260px] truncate">
                        {b.description}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {REVENUE_TYPE_LABEL[b.revenueType ?? ""] ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{formatBRL(open)}</TableCell>
                    <TableCell className="text-sm">hoje · {formatDateBR(b.dueDate)}</TableCell>
                    <TableCell>
                      <Badge variant={b.status === "PARTIAL" ? "warning" : "secondary"}>
                        {b.status === "PARTIAL" ? "Parcial" : "Em aberto"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <MessageDialog
                          phone={b.client.phone}
                          billingId={b.id}
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
                            <Button variant="ghost" size="icon" title="Gerar cobrança / WhatsApp">
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
                        <Button variant="ghost" size="icon" asChild title="Ver cliente">
                          <Link href={`/clientes/${b.client.id}?tab=cobrancas`}>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ===== Bloco 2 — Clientes vencidos (fila priorizada) ===== */}
      <h2 id="vencidos" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2 scroll-mt-24">
        Clientes vencidos — fila priorizada
      </h2>
      <Card className="mb-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prioridade</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead className="text-right">Vencido</TableHead>
                <TableHead>Atraso</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {queue.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    Nenhuma cobrança vencida. Carteira em dia! 🎉
                  </TableCell>
                </TableRow>
              )}
              {queue.map((q) => {
                const pm = PRIORITY_META[q.priority];
                return (
                  <TableRow key={q.clientId} className={q.contactedToday ? "opacity-60" : ""}>
                    <TableCell>
                      <Badge variant={pm.variant}>{pm.label}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium flex items-center gap-1.5">
                        {q.clientName}
                        {q.keyAccount && <Star className="h-3.5 w-3.5 text-amber-500" aria-label="Cliente-chave" />}
                        {q.recurring && <Repeat2 className="h-3.5 w-3.5 text-sky-500" aria-label="Recorrente" />}
                      </span>
                      <span className="block text-xs text-muted-foreground max-w-[240px]">
                        {q.reasons.slice(0, 2).join(" · ")}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium text-red-600">
                      {formatBRL(q.totalOverdue)}
                      <span className="block text-[10px] text-muted-foreground">{q.billingCount} cobrança(s)</span>
                    </TableCell>
                    <TableCell className="text-sm">{q.daysOverdue}d</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ownerByClient.get(q.clientId) ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {q.contactedToday && (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 className="h-3.5 w-3.5" /> contatado hoje
                        </span>
                      )}
                      {q.promise ? (
                        <span className={q.promise.broken ? "text-red-600 font-medium" : ""}>
                          promessa {q.promise.at ? `p/ ${formatDateBR(q.promise.at)}` : "sem data"}
                          {q.promise.broken ? " (vencida!)" : ""}
                        </span>
                      ) : q.lastContactAt ? (
                        <>último contato {formatDateBR(q.lastContactAt)} · {q.attempts} tentativa(s)</>
                      ) : (
                        "nunca contatado"
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <MessageDialog
                          phone={q.phone}
                          billingId={q.anchorBilling.id}
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
                            <Button variant="ghost" size="icon" title="Cobrar no WhatsApp / gerar mensagem">
                              <MessageSquareText className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <NoteDialog
                          billingId={q.anchorBilling.id}
                          trigger={
                            <Button variant="ghost" size="icon" title="Registrar contato / resposta">
                              <NotebookPen className="h-4 w-4" />
                            </Button>
                          }
                        />
                        <NoteDialog
                          billingId={q.anchorBilling.id}
                          promise
                          trigger={
                            <Button variant="ghost" size="icon" title="Registrar promessa de pagamento">
                              <Handshake className="h-4 w-4 text-amber-600" />
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
                            <Button variant="ghost" size="icon" title="Registrar pagamento (cobrança mais antiga)">
                              <BadgeDollarSign className="h-4 w-4 text-emerald-600" />
                            </Button>
                          }
                        />
                        <Button variant="ghost" size="icon" asChild title="Ver recebimentos do cliente">
                          <Link href={`/clientes/${q.clientId}?tab=cobrancas`}>
                            <ArrowRight className="h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ===== Ações pendentes (tarefas com prioridade) ===== */}
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
              Ações pendentes de hoje
            </p>
            {tarefas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Nada urgente. Dia tranquilo! 🎉</p>
            ) : (
              <ol className="space-y-2.5">
                {tarefas.slice(0, 10).map((t, i) => {
                  const pm = PRIORITY_META[t.priority];
                  return (
                    <li key={i}>
                      <Link href={t.href} className="group flex items-start gap-2.5 text-sm">
                        <Badge variant={pm.variant} className="shrink-0 mt-0.5 text-[10px] px-1.5">
                          {pm.label}
                        </Badge>
                        <span className="group-hover:underline">{t.text}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        {/* ===== Bloco 3 — Despesas do dia / próximas ===== */}
        <Card id="despesas" className="scroll-mt-24">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
              Despesas {totalCritico > 0 && <span className="text-red-600">· vencidas!</span>}
            </p>
            {payToday.length === 0 && criticalExpenses.length === 0 && weekExpenses.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma despesa precisando de atenção.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {criticalExpenses.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="text-red-600 min-w-0">
                      <span className="block truncate">{e.description}</span>
                      <span className="block text-[10px]">vencida em {e.dueDate ? formatDateBR(e.dueDate) : "—"}</span>
                    </span>
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <span className="font-medium text-red-600">{formatBRL(Number(e.amount))}</span>
                      <MarkExpensePaid id={e.id} />
                    </span>
                  </li>
                ))}
                {payToday.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate">{e.description}</span>
                      <span className="block text-[10px] text-muted-foreground">vence hoje</span>
                    </span>
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <span className="font-medium">{formatBRL(Number(e.amount))}</span>
                      <MarkExpensePaid id={e.id} />
                    </span>
                  </li>
                ))}
                {weekExpenses.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate">{e.description}</span>
                      <span className="block text-[10px] text-muted-foreground">
                        vence {e.dueDate ? formatDateBR(e.dueDate) : "—"}
                      </span>
                    </span>
                    <span className="flex items-center gap-1 whitespace-nowrap">
                      <span className="font-medium">{formatBRL(Number(e.amount))}</span>
                      <MarkExpensePaid id={e.id} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
              <Link href="/despesas">
                <ExternalLink className="h-3.5 w-3.5 mr-1" /> Ver despesas
              </Link>
            </Button>
          </CardContent>
        </Card>

        {/* ===== Bloco 5 — Oportunidades ===== */}
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
              Oportunidades
            </p>
            {(!renewalsThisMonth || renewalsThisMonth.count === 0) &&
            renewals.length === 0 &&
            openUpsells.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma oportunidade mapeada.</p>
            ) : (
              <div className="space-y-4 text-sm">
                {renewalsThisMonth && renewalsThisMonth.count > 0 && (
                  <div>
                    <p className="text-xs font-medium text-amber-600 mb-1.5">Renovações do mês</p>
                    <Link
                      href={`/clientes?mesRenovacao=${renewalsThisMonth.month}`}
                      className="hover:underline"
                    >
                      {renewalsThisMonth.count} cliente(s) · {formatBRL(renewalsThisMonth.expectedTotal)} esperado
                    </Link>
                    <span className="block text-xs text-muted-foreground">
                      próximo mês: {renewalsNextMonth?.count ?? 0} renovação(ões)
                    </span>
                  </div>
                )}
                {renewals.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">Contratos para renovar (30d)</p>
                    <ul className="space-y-1">
                      {renewals.map((r) => (
                        <li key={r.id} className="flex justify-between gap-2">
                          <span className="truncate">{r.client.name}</span>
                          <span className="whitespace-nowrap text-muted-foreground">
                            {r.renewalDate ? formatDateBR(r.renewalDate) : "—"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {openUpsells.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-emerald-600 mb-1.5">Upsell em negociação</p>
                    <ul className="space-y-1">
                      {openUpsells.map((u) => (
                        <li key={u.id} className="flex justify-between gap-2">
                          <Link href="/upsell" className="truncate hover:underline">
                            {u.client.name}
                          </Link>
                          <span className="whitespace-nowrap font-medium">{formatBRL(Number(u.value))}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
