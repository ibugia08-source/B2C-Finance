import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { SavedViews } from "@/components/saved-views";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthRange, monthLabel } from "@/lib/format";
import { getExpenseSummary } from "@/lib/services/expense-metrics";
import {
  limitesUsadosPorCartao,
} from "@/lib/services/calculations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import { cn } from "@/lib/utils";
import { ExpenseDialog, EXPENSE_TYPE_LABEL, RECURRENCE_LABEL } from "./expense-dialog";
import { ExpenseActions } from "./row-actions";
import { ExpenseFilters } from "./filters";
import { CardDialog } from "@/app/cartoes/card-dialog";
import { CardRowActions } from "@/app/cartoes/row-actions";
import { QuickRenameCard } from "@/app/cartoes/quick-rename";
import { Repeat2 } from "lucide-react";
import { getViewer } from "@/lib/auth/viewer";

type Search = {
  aba?: string; // despesas | cartoes | resumo
  mes?: string;
  status?: string;
  tipo?: string;
  recorrente?: string;
};

function parseMonthRef(mes?: string): Date {
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [y, m] = mes.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }
  return new Date();
}

// "Vencida" é derivada: pendente/devendo com vencimento no passado.
function statusInfo(status: string, dueDate: Date | null): { label: string; variant: any } {
  if (status === "pago") return { label: "Paga", variant: "success" };
  if (status === "cancelado") return { label: "Cancelada", variant: "outline" };
  if (dueDate && dueDate < new Date()) return { label: "Vencida", variant: "destructive" };
  return { label: "Pendente", variant: "warning" };
}

const TABS = [
  { key: "despesas", label: "Despesas" },
  { key: "cartoes", label: "Cartões e Contas" },
  { key: "resumo", label: "Resumo" },
] as const;

export default async function DespesasPage({ searchParams }: { searchParams: Search }) {
  await getViewer();

  const aba = TABS.some((t) => t.key === searchParams.aba) ? searchParams.aba! : "despesas";
  const ref = parseMonthRef(searchParams.mes);

  function tabHref(key: string) {
    const params = new URLSearchParams(searchParams as Record<string, string>);
    params.set("aba", key);
    return `/despesas?${params.toString()}`;
  }

  return (
    <div>
      <PageHeader
        title="Despesas"
        description={`Despesas, cartões e contas da agência · ${monthLabel(ref)}`}
        actions={aba === "despesas" ? <NewExpenseButton /> : undefined}
      />

      <div className="mb-3 print:hidden">
        <SavedViews module="despesas" />
      </div>

      {/* Abas (estilo segmented control) */}
      <div className="mb-4 inline-flex rounded-lg border bg-muted/40 p-1 print:hidden">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={cn(
              "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
              aba === t.key
                ? "bg-background shadow-sm text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {aba === "despesas" && <ExpensesTab searchParams={searchParams} refDate={ref} />}
      {aba === "cartoes" && <CardsTab />}
      {aba === "resumo" && <ResumoTab refDate={ref} />}
    </div>
  );
}

/** Botão "Nova despesa" com a lista de cartões (para o tipo Cartão). */
async function NewExpenseButton() {
  const cards = await prisma.creditCard.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return <ExpenseDialog cards={cards} />;
}

// ===================================================================
// Aba 1 — Despesas
// ===================================================================

async function ExpensesTab({
  searchParams,
  refDate,
}: {
  searchParams: Search;
  refDate: Date;
}) {
  const { start, end } = monthRange(refDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const where: any = {
    type: "despesa",
    date: { gte: start, lt: end },
  };
  if (searchParams.tipo) where.expenseType = searchParams.tipo;
  if (searchParams.recorrente === "sim") where.recurrenceGroupId = { not: null };
  if (searchParams.recorrente === "nao") where.recurrenceGroupId = null;
  if (searchParams.status === "vencida") {
    where.status = { in: ["pendente", "devendo"] };
    where.dueDate = { lt: today };
  } else if (searchParams.status === "pendente") {
    where.status = { in: ["pendente", "devendo"] };
    where.OR = [{ dueDate: null }, { dueDate: { gte: today } }];
  } else if (searchParams.status) {
    where.status = searchParams.status;
  }

  const [expenses, cards, monthAgg] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: [{ dueDate: "asc" }, { date: "desc" }],
      take: 300,
    }),
    prisma.creditCard.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.transaction.findMany({
      where: { type: "despesa", status: { not: "cancelado" }, date: { gte: start, lt: end } },
      select: { amount: true, status: true, dueDate: true },
    }),
  ]);

  const totalMes = monthAgg.reduce((s, e) => s + e.amount, 0);
  const totalPago = monthAgg.filter((e) => e.status === "pago").reduce((s, e) => s + e.amount, 0);
  const vencidas = monthAgg.filter(
    (e) => e.status !== "pago" && e.dueDate && e.dueDate < today
  );
  const totalVencido = vencidas.reduce((s, e) => s + e.amount, 0);
  const totalPendente = totalMes - totalPago - totalVencido;
  const cardName = new Map(cards.map((c) => [c.id, c.name]));

  return (
    <>
      <Card className="mb-4">
        <CardContent className="p-4">
          <ExpenseFilters />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard title="Total do mês" value={formatBRL(totalMes)} intent="negative" />
        <StatCard title="Pagas" value={formatBRL(totalPago)} intent="positive" />
        <StatCard title="Pendentes" value={formatBRL(Math.max(0, totalPendente))} intent="warning" />
        <StatCard
          title="Vencidas"
          value={formatBRL(totalVencido)}
          intent={totalVencido > 0 ? "negative" : "default"}
          hint={vencidas.length > 0 ? `${vencidas.length} despesa(s)` : undefined}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Despesa</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Recorrência</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                      Nenhuma despesa neste período. Adicione sua primeira despesa.
                    </TableCell>
                  </TableRow>
                )}
                {expenses.map((e) => {
                  const st = statusInfo(e.status, e.dueDate);
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium max-w-xs">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate">{e.description}</span>
                          {e.recurrenceGroupId && (
                            <Repeat2 className="h-3.5 w-3.5 text-sky-500 shrink-0" aria-label="Recorrente" />
                          )}
                        </span>
                        {e.expenseType === "CARD" && e.cardId && (
                          <p className="text-xs text-muted-foreground">
                            {cardName.get(e.cardId) ?? "cartão"}
                            {e.cardInvoiceMonth
                              ? ` · fatura ${String(e.cardInvoiceMonth).padStart(2, "0")}/${e.cardInvoiceYear}`
                              : ""}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        {e.expenseType ? EXPENSE_TYPE_LABEL[e.expenseType] ?? e.expenseType : "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {e.recurrenceGroupId
                          ? RECURRENCE_LABEL[e.recurrence ?? "MONTHLY"] ?? "Recorrente"
                          : "—"}
                      </TableCell>
                      <TableCell>{e.dueDate ? formatDateBR(e.dueDate) : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium text-red-600 dark:text-red-400">
                        -{formatBRL(e.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <ExpenseActions expense={e} cards={cards} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <MobileCards>
            {expenses.length === 0 ? (
              <MobileEmpty>Nenhuma despesa neste período.</MobileEmpty>
            ) : (
              expenses.map((e) => {
                const st = statusInfo(e.status, e.dueDate);
                return (
                  <MobileCard key={e.id}>
                    <MobileCardHeader
                      title={
                        <span className="flex items-center gap-1.5">
                          {e.description}
                          {e.recurrenceGroupId && (
                            <Repeat2 className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                          )}
                        </span>
                      }
                      aside={
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          -{formatBRL(e.amount)}
                        </span>
                      }
                    />
                    <div className="space-y-1.5">
                      <Field label="Tipo">
                        {e.expenseType ? EXPENSE_TYPE_LABEL[e.expenseType] ?? e.expenseType : "—"}
                      </Field>
                      <Field label="Vencimento">
                        {e.dueDate ? formatDateBR(e.dueDate) : "—"}
                      </Field>
                      <Field label="Status">
                        <Badge variant={st.variant}>{st.label}</Badge>
                      </Field>
                    </div>
                    <MobileCardActions>
                      <ExpenseActions expense={e} cards={cards} />
                    </MobileCardActions>
                  </MobileCard>
                );
              })
            )}
          </MobileCards>
        </CardContent>
      </Card>
    </>
  );
}

// ===================================================================
// Aba 2 — Cartões e Contas (configuração; sem importação de fatura)
// ===================================================================

async function CardsTab() {
  const [cards, people, accounts] = await Promise.all([
    prisma.creditCard.findMany({ orderBy: { name: "asc" }, include: { holder: true } }),
    prisma.person.findMany({ orderBy: { name: "asc" } }),
    prisma.account.findMany({ orderBy: { name: "asc" } }),
  ]);
  const usedByCard = await limitesUsadosPorCartao(cards.map((c) => c.id));

  return (
    <>
      <div className="flex justify-end mb-4">
        <CardDialog people={people} accounts={accounts} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="py-12 text-center text-muted-foreground">
              Nenhuma conta/cartão cadastrado ainda.
            </CardContent>
          </Card>
        )}
        {cards.map((c) => {
          const used = usedByCard.get(c.id) ?? 0;
          const available = Math.max(0, c.limitTotal - used);
          const pct = c.limitTotal > 0 ? (used / c.limitTotal) * 100 : 0;
          return (
            <Card key={c.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <QuickRenameCard id={c.id} name={c.name} />
                  <Badge variant={c.active ? "secondary" : "outline"} className="capitalize">
                    {c.active ? c.type : "inativo"}
                  </Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  {c.bank ?? "—"} · Fecha dia {c.closingDay} · Vence dia {c.dueDay}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span>Limite usado</span>
                    <span className="font-medium">
                      {formatBRL(used)} / {formatBRL(c.limitTotal)}
                    </span>
                  </div>
                  <Progress value={pct} />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-muted-foreground">Disponível</p>
                    <p className="font-medium text-emerald-600">{formatBRL(available)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Titular</p>
                    <p className="font-medium">{c.holder?.name ?? "—"}</p>
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <CardRowActions card={c} people={people} accounts={accounts} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ===================================================================
// Aba 3 — Resumo (mini dashboard de despesas)
// ===================================================================

async function ResumoTab({ refDate }: { refDate: Date }) {
  const s = await getExpenseSummary(refDate);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-4">
        <StatCard title="Total do mês" value={formatBRL(s.total)} intent="negative"
          hint={`${s.count} despesa(s)`} />
        <StatCard title="Pagas" value={formatBRL(s.paid)} intent="positive" />
        <StatCard title="Pendentes" value={formatBRL(s.pending)} intent="warning" />
        <StatCard title="Vencidas" value={formatBRL(s.overdue)}
          intent={s.overdue > 0 ? "negative" : "default"}
          hint={s.overdueCount > 0 ? `${s.overdueCount} despesa(s)` : undefined} />
        <StatCard title="Recorrentes do mês" value={formatBRL(s.recurring)}
          hint={`${s.recurringCount} despesa(s)`} />
        <StatCard title="Total em cartão" value={formatBRL(s.cardExpenses)} />
        <StatCard title="Débitos em faturas" value={formatBRL(s.invoiceOpenTotal)}
          intent={s.invoiceOpenTotal > 0 ? "warning" : "default"} />
        <StatCard title="Limite disponível" value={formatBRL(s.creditLimitAvailable)}
          hint={`de ${formatBRL(s.creditLimitTotal)} · usado ${formatBRL(s.creditLimitUsed)}`} />
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2">
            Próximos vencimentos (7 dias)
          </p>
          {s.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada vencendo nos próximos 7 dias.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {s.upcoming.map((u) => (
                <li key={u.id} className="flex justify-between gap-2">
                  <span className="truncate">{u.description}</span>
                  <span className="whitespace-nowrap text-muted-foreground">
                    {formatDateBR(u.dueDate)} ·{" "}
                    <strong className="text-foreground">{formatBRL(u.amount)}</strong>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
