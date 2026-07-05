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

  const [queue, cash, accounts, payToday, criticalExpenses, weekBillings, weekExpenses, receivedPayments, receivedIncomes, openAgg, renewals] =
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
      prisma.billing.aggregate({
        where: { status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        _sum: { amount: true, paidTotal: true },
      }),
      prisma.contract.findMany({
        where: { status: { in: ["ACTIVE", "RENEWAL"] }, renewalDate: { not: null, lte: in30 } },
        orderBy: { renewalDate: "asc" },
        take: 8,
        select: { id: true, title: true, renewalDate: true, monthlyValue: true, client: { select: { name: true } } },
      }),
    ]);

  const n = (v: unknown) => (v == null ? 0 : Number(v));
  const cobrarHoje = queue.filter((q) => !q.contactedToday);
  const totalCobrar = queue.reduce((s, q) => s + q.totalOverdue, 0);
  const totalPagarHoje = payToday.reduce((s, t) => s + n(t.amount), 0);
  const totalCritico = criticalExpenses.reduce((s, t) => s + n(t.amount), 0);
  const recebidoHoje =
    receivedPayments.reduce((s, p) => s + n(p.amount), 0) +
    receivedIncomes.reduce((s, i) => s + n(i.amount), 0);
  const faltaReceber = n(openAgg._sum.amount) - n(openAgg._sum.paidTotal);
  const promessas = queue.filter((q) => q.promise);

  // Alertas de caixa
  const cashAlerts: string[] = [];
  if (cash.caixaDisponivel <= 0) cashAlerts.push(`Caixa disponível zerado/negativo (${formatBRL(cash.caixaDisponivel)}).`);
  if (cash.projecao30 < 0) cashAlerts.push(`Projeção de caixa NEGATIVA em 30 dias (${formatBRL(cash.projecao30)}).`);
  const pagarSemana = totalPagarHoje + totalCritico + weekExpenses.reduce((s, t) => s + n(t.amount), 0);
  if (pagarSemana > cash.caixaDisponivel && cash.caixaDisponivel > 0)
    cashAlerts.push(`Compromissos da semana (${formatBRL(pagarSemana)}) maiores que o caixa (${formatBRL(cash.caixaDisponivel)}).`);

  // Tarefas sugeridas
  const tarefas: { text: string; href: string }[] = [];
  for (const q of cobrarHoje.filter((x) => x.priority === "alta").slice(0, 3)) {
    tarefas.push({ text: `Cobrar ${q.clientName} — ${formatBRL(q.totalOverdue)} (${q.reasons[0]})`, href: "#fila" });
  }
  for (const p of promessas.filter((x) => x.promise?.broken).slice(0, 2)) {
    tarefas.push({ text: `Retomar contato com ${p.clientName} — promessa de pagamento vencida`, href: "#fila" });
  }
  if (totalCritico > 0)
    tarefas.push({ text: `Resolver ${criticalExpenses.length} despesa(s) vencida(s) — ${formatBRL(totalCritico)}`, href: "/despesas" });
  if (totalPagarHoje > 0)
    tarefas.push({ text: `Pagar ${payToday.length} despesa(s) de hoje — ${formatBRL(totalPagarHoje)}`, href: "/despesas" });
  for (const r of renewals.slice(0, 2)) {
    tarefas.push({
      text: `Encaminhar renovação de "${r.title}" (${r.client.name}) — ${r.renewalDate ? formatDateBR(r.renewalDate) : ""}`,
      href: "/contratos",
    });
  }
  if (cash.projecao30 < 0)
    tarefas.push({ text: "Antecipar recebíveis ou renegociar prazos — caixa projetado negativo", href: "/financeiro" });

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
        <StatCard title="Falta receber (aberto)" value={formatBRL(faltaReceber)} />
      </div>

      {cashAlerts.length > 0 && (
        <Card className="mb-4 border-red-500/50 bg-red-500/5">
          <CardContent className="p-4 space-y-1">
            {cashAlerts.map((a, i) => (
              <p key={i} className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" /> {a}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

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
                        <Button variant="ghost" size="icon" asChild title="Ver todas as cobranças do cliente">
                          <Link href={`/cobrancas?cliente=${q.clientId}`}>
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
                {tarefas.slice(0, 8).map((t, i) => (
                  <li key={i}>
                    <Link href={t.href} className="group flex items-start gap-2.5 text-sm">
                      <span className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <span className="group-hover:underline">{t.text}</span>
                    </Link>
                  </li>
                ))}
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
