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
import { getRenewalOutlook, getReceiptsSummary } from "@/lib/services/revenue-metrics";
import { getExpenseSummary } from "@/lib/services/expense-metrics";
import { getMonthlySeries } from "@/lib/services/dashboard-metrics";
import { limitesUsadosPorCartao } from "@/lib/services/calculations";
import { AISuggestionsPanel } from "./ai-suggestions";
import { TONE_LABEL } from "@/lib/billing-message";
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
  AlertTriangle, CheckCircle2, ArrowRight, Star, Repeat2,
} from "lucide-react";

const PRIORITY_META: Record<string, { label: string; variant: any }> = {
  alta: { label: "Alta", variant: "destructive" },
  media: { label: "Média", variant: "warning" },
  baixa: { label: "Baixa", variant: "secondary" },
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

  const [
    queue, cash, accounts, payToday, criticalExpenses, weekBillings, weekExpenses,
    receivedPayments, receivedIncomes, receiptsMes, renewals,
    renewalWindows, finance, expenseSummary, series, openUpsells, cardsAll, devendoMes,
  ] =
    await Promise.all([
      getCollectionQueue(),
      getCashSummary(resolvePeriod({ periodo: "mes" })),
      prisma.account.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
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
      prisma.billing.findMany({
        where: { status: { in: ["PENDING", "PARTIAL"] }, dueDate: { gte: today, lt: in7 } },
        orderBy: { dueDate: "asc" },
        take: 15,
        select: {
          description: true, amount: true, paidTotal: true, dueDate: true,
          client: { select: { name: true } },
        },
      }),
      prisma.transaction.findMany({
        where: { type: "despesa", status: { in: ["pendente", "devendo"] }, dueDate: { gte: tomorrow, lt: in7 } },
        orderBy: { dueDate: "asc" },
        take: 15,
        select: { description: true, amount: true, dueDate: true },
      }),
      prisma.payment.findMany({
        where: { status: "CONFIRMED", paidAt: { gte: today, lt: tomorrow } },
        select: { amount: true, billing: { select: { description: true, client: { select: { name: true } } } } },
      }),
      prisma.income.findMany({
        where: { status: "RECEIVED", billingId: null, receivedAt: { gte: today, lt: tomorrow } },
        select: { amount: true, description: true },
      }),
      // Métrica oficial do MÊS VIGENTE — mesma função do Dashboard
      // (Falta receber = previsto do mês − recebido do mês; nunca soma
      // inadimplência de meses anteriores — isso é o card "A cobrar").
      getReceiptsSummary(
        resolvePeriod({ periodo: "mes" }).start,
        resolvePeriod({ periodo: "mes" }).end
      ),
      prisma.contract.findMany({
        where: { status: { in: ["ACTIVE", "RENEWAL"] }, renewalDate: { not: null, lte: in30 } },
        orderBy: { renewalDate: "asc" },
        take: 8,
        select: { id: true, title: true, renewalDate: true, monthlyValue: true, client: { select: { name: true } } },
      }),
      getRenewalOutlook([0, 1]),
      getFinanceSummary(resolvePeriod({ periodo: "mes" })),
      getExpenseSummary(),
      getMonthlySeries({ period: resolvePeriod({ periodo: "mes" }) }),
      prisma.upsell.findMany({
        where: { status: { in: ["OPPORTUNITY", "NEGOTIATION"] } },
        orderBy: { value: "desc" },
        take: 6,
        select: {
          id: true, title: true, value: true, responsible: true, expectedCloseAt: true,
          client: { select: { name: true } },
          service: { select: { name: true } },
          offer: { select: { name: true } },
        },
      }),
      prisma.creditCard.findMany({
        where: { active: true },
        select: { id: true, name: true, limitTotal: true, dueDay: true },
      }),
      prisma.client.count({ where: { status: "DELINQUENT" } }),
    ]);

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

  // ===== Tendências (mês atual × anterior) =====
  const last = (arr: number[]) => arr[arr.length - 1] ?? 0;
  const prev = (arr: number[]) => arr[arr.length - 2] ?? 0;
  const trendAlerts: { text: string; critical: boolean }[] = [];
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

  const renewalsThisMonth = renewalWindows[0];
  const renewalsNextMonth = renewalWindows[1];

  const n = (v: unknown) => (v == null ? 0 : Number(v));
  const cobrarHoje = queue.filter((q) => !q.contactedToday);
  const totalCobrar = queue.reduce((s, q) => s + q.totalOverdue, 0);
  const totalPagarHoje = payToday.reduce((s, t) => s + n(t.amount), 0);
  const totalCritico = criticalExpenses.reduce((s, t) => s + n(t.amount), 0);
  const recebidoHoje =
    receivedPayments.reduce((s, p) => s + n(p.amount), 0) +
    receivedIncomes.reduce((s, i) => s + n(i.amount), 0);
  // Falta receber = Em aberto do mês vigente (fórmula oficial, camada central).
  const faltaReceber = receiptsMes.openMonth;
  const promessas = queue.filter((q) => q.promise);

  // Alertas de caixa
  const cashAlerts: string[] = [];
  if (cash.caixaDisponivel <= 0) cashAlerts.push(`Caixa disponível zerado/negativo (${formatBRL(cash.caixaDisponivel)}).`);
  if (cash.projecao30 < 0) cashAlerts.push(`Projeção de caixa NEGATIVA em 30 dias (${formatBRL(cash.projecao30)}).`);
  const pagarSemana = totalPagarHoje + totalCritico + weekExpenses.reduce((s, t) => s + n(t.amount), 0);
  if (pagarSemana > cash.caixaDisponivel && cash.caixaDisponivel > 0)
    cashAlerts.push(`Compromissos da semana (${formatBRL(pagarSemana)}) maiores que o caixa (${formatBRL(cash.caixaDisponivel)}).`);

  // ===== Tarefas sugeridas COM PRIORIDADE (impacto × urgência × valor) =====
  type Tarefa = { priority: "alta" | "media" | "baixa"; text: string; href: string };
  const tarefas: Tarefa[] = [];
  for (const q of cobrarHoje.filter((x) => x.priority === "alta").slice(0, 3)) {
    tarefas.push({ priority: "alta", text: `Cobrar ${q.clientName} — ${formatBRL(q.totalOverdue)} (${q.reasons[0]})`, href: "#fila" });
  }
  if (cash.projecao30 < 0)
    tarefas.push({ priority: "alta", text: "Antecipar recebíveis ou renegociar prazos — caixa projetado negativo em 30 dias", href: "/cobrancas" });
  if (totalCritico > 0)
    tarefas.push({ priority: "alta", text: `Resolver ${criticalExpenses.length} despesa(s) vencida(s) — ${formatBRL(totalCritico)}`, href: "/despesas?status=vencida" });
  for (const p of promessas.filter((x) => x.promise?.broken).slice(0, 2)) {
    tarefas.push({ priority: "alta", text: `Retomar contato com ${p.clientName} — promessa de pagamento vencida`, href: "#fila" });
  }
  if (totalPagarHoje > 0)
    tarefas.push({ priority: "media", text: `Pagar ${payToday.length} despesa(s) de hoje — ${formatBRL(totalPagarHoje)}`, href: "/despesas" });
  if (renewalsThisMonth && renewalsThisMonth.count > 0)
    tarefas.push({
      priority: "media",
      text: `Encaminhar ${renewalsThisMonth.count} renovação(ões) do mês — ${formatBRL(renewalsThisMonth.expectedTotal)} esperado`,
      href: `/clientes?mesRenovacao=${renewalsThisMonth.month}`,
    });
  for (const r of renewals.slice(0, 2)) {
    tarefas.push({
      priority: "media",
      text: `Renovar contrato "${r.title}" (${r.client.name}) — ${r.renewalDate ? formatDateBR(r.renewalDate) : ""}`,
      href: "/acordos",
    });
  }
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

  return (
    <div>
      <PageHeader
        title="Rotina financeira"
        description={`Seu dia de cobrança e pagamentos · ${formatDateBR(new Date())}`}
      />

      <div className="mb-3">
        <SavedViews module="rotina" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard title="A cobrar (vencido)" value={formatBRL(totalCobrar)}
          intent={totalCobrar > 0 ? "negative" : "positive"}
          hint={`${queue.length} cliente(s) · ${cobrarHoje.length} sem contato hoje`} />
        <StatCard title="A pagar hoje" value={formatBRL(totalPagarHoje + totalCritico)}
          intent={totalCritico > 0 ? "negative" : "default"}
          hint={totalCritico > 0 ? `${formatBRL(totalCritico)} já vencido!` : `${payToday.length} despesa(s)`} />
        <StatCard title="Recebido hoje" value={formatBRL(recebidoHoje)} intent="positive" />
        <StatCard title="Falta receber (mês)" value={formatBRL(faltaReceber)}
          hint="previsto do mês − recebido" />
      </div>

      {/* Operação do mês — fechamento mensal detalhado fica no Dashboard/relatórios. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard
          href={renewalsThisMonth ? `/clientes?mesRenovacao=${renewalsThisMonth.month}` : "/clientes"}
          title="Renovações do mês"
          value={String(renewalsThisMonth?.count ?? 0)}
          intent={(renewalsThisMonth?.count ?? 0) > 0 ? "warning" : "default"}
          hint={`${formatBRL(renewalsThisMonth?.expectedTotal ?? 0)} esperado · próx. mês: ${renewalsNextMonth?.count ?? 0}`}
        />
        <StatCard
          href="/clientes?inadimplencia=devendo"
          title="Clientes em aberto no mês"
          value={String(devendoMes)}
          intent={devendoMes > 0 ? "negative" : "positive"}
          hint="ainda sem pagamento registrado"
        />
        <StatCard
          href="/upsell"
          title="Upsell em aberto"
          value={String(openUpsells.length)}
          hint={formatBRL(openUpsells.reduce((s, u) => s + Number(u.value), 0))}
        />
      </div>

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
                <AlertTriangle
                  className={`h-4 w-4 shrink-0 ${a.critical ? "text-red-500" : "text-amber-500"}`}
                />
                {a.text}
              </p>
            ))}
            {cardWarnings.map((a, i) => (
              <p key={`w${i}`} className="text-sm flex items-center gap-2">
                <AlertTriangle
                  className={`h-4 w-4 shrink-0 ${a.critical ? "text-red-500" : "text-amber-500"}`}
                />
                {a.text}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="mb-6">
        <AISuggestionsPanel />
      </div>

      {/* ===== Fila de cobrança priorizada ===== */}
      <h2 id="fila" className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">
        O que cobrar hoje — fila priorizada
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
                <TableHead>Situação</TableHead>
                <TableHead>Tom sugerido</TableHead>
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
                      <span className="block text-[10px] text-muted-foreground mt-0.5">score {q.score}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium flex items-center gap-1.5">
                        {q.clientName}
                        {q.keyAccount && <Star className="h-3.5 w-3.5 text-amber-500" aria-label="Cliente-chave" />}
                        {q.recurring && <Repeat2 className="h-3.5 w-3.5 text-sky-500" aria-label="Recorrente" />}
                      </span>
                      <span className="block text-xs text-muted-foreground max-w-[260px]">
                        {q.reasons.slice(0, 3).join(" · ")}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-medium text-red-600">
                      {formatBRL(q.totalOverdue)}
                      <span className="block text-[10px] text-muted-foreground">{q.billingCount} cobrança(s)</span>
                    </TableCell>
                    <TableCell className="text-sm">{q.daysOverdue}d</TableCell>
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
                      <Badge variant="outline">{TONE_LABEL[q.suggestedTone]}</Badge>
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
                            <Button variant="ghost" size="icon" title="Gerar mensagem / WhatsApp">
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
                          <Link href={`/clientes/${q.clientId}?tab=recebimentos`}>
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
        {/* Tarefas sugeridas */}
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
              Tarefas financeiras de hoje
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

        {/* Promessas */}
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
              Promessas de pagamento
            </p>
            {promessas.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma promessa registrada.</p>
            ) : (
              <ul className="space-y-2.5">
                {promessas.map((p) => (
                  <li key={p.clientId} className="text-sm flex items-start gap-2">
                    <Handshake className={`h-4 w-4 mt-0.5 shrink-0 ${p.promise!.broken ? "text-red-500" : "text-amber-500"}`} />
                    <span>
                      <strong>{p.clientName}</strong> — {formatBRL(p.totalOverdue)}
                      <span className="block text-xs text-muted-foreground">
                        {p.promise!.at ? `prometido para ${formatDateBR(p.promise!.at)}` : "sem data definida"}
                        {p.promise!.broken && <span className="text-red-600 font-medium"> · não cumprida</span>}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Pagar hoje + críticas */}
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
              Pagar hoje {totalCritico > 0 && <span className="text-red-600">· vencidas!</span>}
            </p>
            {payToday.length === 0 && criticalExpenses.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">Nada a pagar hoje.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {criticalExpenses.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="text-red-600">{e.description}
                      <span className="block text-[10px]">vencida em {e.dueDate ? formatDateBR(e.dueDate) : "—"}</span>
                    </span>
                    <span className="font-medium text-red-600 whitespace-nowrap">{formatBRL(Number(e.amount))}</span>
                  </li>
                ))}
                {payToday.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span>{e.description}</span>
                    <span className="font-medium whitespace-nowrap">{formatBRL(Number(e.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
              <Link href="/despesas">Abrir despesas</Link>
            </Button>
          </CardContent>
        </Card>

        {/* Vence na semana */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
              Vence nos próximos 7 dias
            </p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-emerald-600 mb-2">A receber (cobranças)</p>
                {weekBillings.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma cobrança na semana.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {weekBillings.map((b, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate">{b.client.name} — {b.description}</span>
                        <span className="whitespace-nowrap text-muted-foreground">
                          {formatDateBR(b.dueDate)} · <strong className="text-foreground">{formatBRL(Number(b.amount) - Number(b.paidTotal))}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-red-600 mb-2">A pagar (despesas)</p>
                {weekExpenses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma despesa na semana.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {weekExpenses.map((e, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="truncate">{e.description}</span>
                        <span className="whitespace-nowrap text-muted-foreground">
                          {e.dueDate ? formatDateBR(e.dueDate) : "—"} · <strong className="text-foreground">{formatBRL(Number(e.amount))}</strong>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recebido hoje + renovações */}
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-3">
              Recebido hoje · {formatBRL(recebidoHoje)}
            </p>
            {receivedPayments.length === 0 && receivedIncomes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum recebimento hoje ainda.</p>
            ) : (
              <ul className="space-y-1.5 text-sm mb-4">
                {receivedPayments.map((p, i) => (
                  <li key={`p${i}`} className="flex justify-between gap-2">
                    <span className="truncate">{p.billing.client.name} — {p.billing.description}</span>
                    <span className="font-medium text-emerald-600 whitespace-nowrap">{formatBRL(Number(p.amount))}</span>
                  </li>
                ))}
                {receivedIncomes.map((inc, i) => (
                  <li key={`i${i}`} className="flex justify-between gap-2">
                    <span className="truncate">{inc.description || "Receita avulsa"}</span>
                    <span className="font-medium text-emerald-600 whitespace-nowrap">{formatBRL(Number(inc.amount))}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2 mt-4">
              Contratos para renovar (30d)
            </p>
            {renewals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma renovação próxima.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {renewals.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2">
                    <span className="truncate">{r.client.name} — {r.title}</span>
                    <span className="whitespace-nowrap text-muted-foreground">
                      {r.renewalDate ? formatDateBR(r.renewalDate) : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
