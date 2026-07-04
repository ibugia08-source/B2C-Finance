import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthRange } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import { ArrowLeft, UserCheck } from "lucide-react";
import { PaymentDialog } from "./payment-dialog";
import { BillingDialog } from "./billing-dialog";
import {
  StatusSelect,
  CategorySelect,
  ResponsibleInline,
} from "./tx-inline-edit";
import { PaymentDeleteButton } from "./payment-row-actions";
import { LinkUserPicker } from "./link-user";
import { PersonMonthFilter } from "./month-filter";
import { getViewer } from "@/lib/auth/viewer";

function parseMonthRef(mes?: string): Date {
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [y, m] = mes.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }
  return new Date();
}

function toMonthValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  pendente: "Aberto",
  pago: "Pago",
  devendo: "Devendo",
  reembolsado: "Reembolsado",
  cancelado: "Cancelado",
};

function statusVariant(s: string): any {
  if (s === "pago" || s === "reembolsado") return "success";
  if (s === "devendo") return "destructive";
  if (s === "cancelado") return "outline";
  return "warning";
}

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  PIX: "Pix",
  TRANSFER: "Transferência",
  CASH: "Dinheiro",
  OTHER: "Outro",
};

export default async function PersonDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { mes?: string };
}) {
  const viewer = await getViewer(`/pessoas/${params.id}`);

  // findUnique é pós-filtrado por dono (extensão) → pessoa de outro usuário
  // resolve para null e cai em notFound.
  const person = await prisma.person.findUnique({
    where: { id: params.id },
    include: { user: true },
  });
  if (!person) notFound();

  const ref = parseMonthRef(searchParams?.mes);
  const { start, end } = monthRange(ref);

  const [
    transactions,
    receivables,
    payments,
    accounts,
    categories,
    people,
    cards,
    availableUsers,
  ] = await Promise.all([
    prisma.transaction.findMany({
      where: { responsibleId: person.id, status: { not: "cancelado" } },
      orderBy: { date: "desc" },
      include: { card: true, account: true, category: true },
    }),
    prisma.receivable.findMany({
      where: { personId: person.id },
      include: { transaction: true },
      orderBy: { dueDate: "asc" },
    }),
    prisma.personPayment.findMany({
      where: { personId: person.id },
      orderBy: { paidAt: "desc" },
      include: { account: true },
    }),
    prisma.account.findMany({ orderBy: { name: "asc" } }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.person.findMany({ orderBy: { name: "asc" } }),
    prisma.creditCard.findMany({ orderBy: { name: "asc" } }),
    viewer.role === "ADMIN"
      ? prisma.user.findMany({
          where: { active: true, OR: [{ person: null }, { person: { id: person.id } }] },
          orderBy: { name: "asc" },
          select: { id: true, name: true, email: true, role: true },
        })
      : Promise.resolve([] as { id: string; name: string; email: string; role: string }[]),
  ]);

  // Resumos
  const transactionsMonth = transactions.filter((t) => t.date >= start && t.date < end);
  const totalGastoMes = transactionsMonth
    .filter((t) => t.type === "despesa")
    .reduce((s, t) => s + t.amount, 0);
  const totalGastoTotal = transactions
    .filter((t) => t.type === "despesa")
    .reduce((s, t) => s + t.amount, 0);
  const totalDevendo = receivables
    .filter((r) => ["aberto", "atrasado", "renegociado"].includes(r.status))
    .reduce((s, r) => s + r.amount, 0);
  const totalPagoReceivables = receivables
    .filter((r) => r.status === "pago")
    .reduce((s, r) => s + r.amount, 0);
  const totalPagamentos = payments.reduce((s, p) => s + p.amount, 0);
  const totalAtrasado = receivables
    .filter((r) => r.status === "atrasado")
    .reduce((s, r) => s + r.amount, 0);
  const totalReembolsavel = transactions
    .filter((t) => t.reimbursable)
    .reduce((s, t) => s + t.amount, 0);

  const lastPayment = payments[0] ?? null;

  // Resumo por cartão
  type ByCard = {
    cardId: string | null;
    name: string;
    bank: string | null;
    total: number;
    devendo: number;
    pago: number;
    count: number;
  };
  const byCardMap = new Map<string, ByCard>();
  for (const t of transactions) {
    if (!t.cardId) continue;
    const key = t.cardId;
    const e = byCardMap.get(key) ?? {
      cardId: t.cardId,
      name: t.card?.name ?? "—",
      bank: t.card?.bank ?? null,
      total: 0,
      devendo: 0,
      pago: 0,
      count: 0,
    };
    e.total += t.amount;
    if (t.status === "devendo") e.devendo += t.amount;
    else if (t.status === "pago" || t.status === "reembolsado") e.pago += t.amount;
    e.count += 1;
    byCardMap.set(key, e);
  }
  const byCard = Array.from(byCardMap.values()).sort((a, b) => b.total - a.total);

  // Resumo por conta
  type ByAccount = {
    accountId: string | null;
    name: string;
    bank: string | null;
    total: number;
    pago: number;
    pendente: number;
  };
  const byAccountMap = new Map<string, ByAccount>();
  for (const t of transactions) {
    if (!t.accountId) continue;
    const key = t.accountId;
    const e = byAccountMap.get(key) ?? {
      accountId: t.accountId,
      name: t.account?.name ?? "—",
      bank: t.account?.bank ?? null,
      total: 0,
      pago: 0,
      pendente: 0,
    };
    e.total += t.amount;
    if (t.status === "pago") e.pago += t.amount;
    else if (t.status === "pendente" || t.status === "devendo") e.pendente += t.amount;
    byAccountMap.set(key, e);
  }
  const byAccount = Array.from(byAccountMap.values()).sort((a, b) => b.total - a.total);

  // Resumo por categoria
  type ByCategory = { categoryId: string | null; name: string; total: number; count: number };
  const byCatMap = new Map<string, ByCategory>();
  for (const t of transactions) {
    const key = t.categoryId ?? "__none__";
    const e = byCatMap.get(key) ?? {
      categoryId: t.categoryId,
      name: t.category?.name ?? "Sem categoria",
      total: 0,
      count: 0,
    };
    e.total += t.amount;
    e.count += 1;
    byCatMap.set(key, e);
  }
  const byCategory = Array.from(byCatMap.values()).sort((a, b) => b.total - a.total);

  return (
    <div>
      <div className="mb-2">
        <Link
          href="/pessoas"
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para pessoas
        </Link>
      </div>
      <PageHeader
        title={person.name}
        description={person.notes ?? undefined}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <PersonMonthFilter current={toMonthValue(ref)} />
            <BillingDialog personId={person.id} />
            <PaymentDialog personId={person.id} accounts={accounts} />
          </div>
        }
      />
      <div className="-mt-3 mb-4 flex flex-wrap items-center gap-3">
        <Badge variant="secondary" className="capitalize">
          {person.type}
        </Badge>
        {person.user ? (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400">
            <UserCheck className="h-4 w-4" /> {person.user.email}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Sem usuário vinculado</span>
        )}
      </div>

      {viewer.role === "ADMIN" && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Vínculo com usuário</CardTitle>
          </CardHeader>
          <CardContent>
            <LinkUserPicker
              personId={person.id}
              currentUserId={person.userId}
              users={availableUsers}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Usuários comuns vinculados a esta pessoa visualizam apenas dados próprios.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard title="Total gasto (mês)" value={formatBRL(totalGastoMes)} intent="negative" />
        <StatCard title="Total gasto (geral)" value={formatBRL(totalGastoTotal)} />
        <StatCard title="Total devendo" value={formatBRL(totalDevendo)} intent="warning" />
        <StatCard title="Total já pago" value={formatBRL(totalPagamentos + totalPagoReceivables)} intent="positive" />
        <StatCard title="Total atrasado" value={formatBRL(totalAtrasado)} intent="negative" />
        <StatCard title="Reembolsável" value={formatBRL(totalReembolsavel)} />
        <StatCard title="Transações" value={String(transactions.length)} />
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Último pagamento
            </p>
            {lastPayment ? (
              <>
                <p className="text-2xl font-bold mt-1 text-emerald-600">
                  {formatBRL(lastPayment.amount)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {formatDateBR(lastPayment.paidAt)} ·{" "}
                  {PAYMENT_METHOD_LABEL[lastPayment.method] ?? lastPayment.method}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground mt-2">Nenhum pagamento registrado.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle>Resumo por cartão</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Desktop: tabela */}
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cartão</TableHead>
                  <TableHead>Banco</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Devendo</TableHead>
                  <TableHead className="text-right">Pago</TableHead>
                  <TableHead className="text-right">Qtd</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byCard.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                      Sem gastos em cartão.
                    </TableCell>
                  </TableRow>
                )}
                {byCard.map((c) => (
                  <TableRow key={c.cardId ?? "—"}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.bank ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatBRL(c.total)}</TableCell>
                    <TableCell className="text-right text-red-600">{formatBRL(c.devendo)}</TableCell>
                    <TableCell className="text-right text-emerald-600">{formatBRL(c.pago)}</TableCell>
                    <TableCell className="text-right">{c.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>

            {/* Mobile: resumo por cartão em cards */}
            <MobileCards>
              {byCard.length === 0 ? (
                <MobileEmpty>Sem gastos em cartão.</MobileEmpty>
              ) : (
                byCard.map((c) => (
                  <MobileCard key={c.cardId ?? "—"}>
                    <MobileCardHeader
                      title={c.name}
                      aside={<span className="font-semibold">{formatBRL(c.total)}</span>}
                    />
                    <div className="space-y-1.5">
                      <Field label="Banco">{c.bank ?? "—"}</Field>
                      <Field label="Devendo">
                        <span className="text-red-600">{formatBRL(c.devendo)}</span>
                      </Field>
                      <Field label="Pago">
                        <span className="text-emerald-600">{formatBRL(c.pago)}</span>
                      </Field>
                      <Field label="Qtd">{c.count}</Field>
                    </div>
                  </MobileCard>
                ))
              )}
            </MobileCards>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resumo por conta</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Desktop: tabela */}
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Conta</TableHead>
                  <TableHead>Banco</TableHead>
                  <TableHead className="text-right">Movimentado</TableHead>
                  <TableHead className="text-right">Pago</TableHead>
                  <TableHead className="text-right">Pendente</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byAccount.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                      Sem movimentações em conta.
                    </TableCell>
                  </TableRow>
                )}
                {byAccount.map((a) => (
                  <TableRow key={a.accountId ?? "—"}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell>{a.bank ?? "—"}</TableCell>
                    <TableCell className="text-right">{formatBRL(a.total)}</TableCell>
                    <TableCell className="text-right text-emerald-600">{formatBRL(a.pago)}</TableCell>
                    <TableCell className="text-right text-amber-600">{formatBRL(a.pendente)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>

            {/* Mobile: resumo por conta em cards */}
            <MobileCards>
              {byAccount.length === 0 ? (
                <MobileEmpty>Sem movimentações em conta.</MobileEmpty>
              ) : (
                byAccount.map((a) => (
                  <MobileCard key={a.accountId ?? "—"}>
                    <MobileCardHeader
                      title={a.name}
                      aside={<span className="font-semibold">{formatBRL(a.total)}</span>}
                    />
                    <div className="space-y-1.5">
                      <Field label="Banco">{a.bank ?? "—"}</Field>
                      <Field label="Pago">
                        <span className="text-emerald-600">{formatBRL(a.pago)}</span>
                      </Field>
                      <Field label="Pendente">
                        <span className="text-amber-600">{formatBRL(a.pendente)}</span>
                      </Field>
                    </div>
                  </MobileCard>
                ))
              )}
            </MobileCards>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Resumo por categoria</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop: tabela */}
          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byCategory.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                    Sem categorias.
                  </TableCell>
                </TableRow>
              )}
              {byCategory.map((c) => (
                <TableRow key={c.categoryId ?? "none"}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="text-right">{formatBRL(c.total)}</TableCell>
                  <TableCell className="text-right">{c.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Mobile: resumo por categoria em cards */}
          <MobileCards>
            {byCategory.length === 0 ? (
              <MobileEmpty>Sem categorias.</MobileEmpty>
            ) : (
              byCategory.map((c) => (
                <MobileCard key={c.categoryId ?? "none"}>
                  <MobileCardHeader
                    title={c.name}
                    aside={<span className="font-semibold">{formatBRL(c.total)}</span>}
                  />
                  <div className="space-y-1.5">
                    <Field label="Quantidade">{c.count}</Field>
                  </div>
                </MobileCard>
              ))
            )}
          </MobileCards>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Histórico de pagamentos</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop: tabela */}
          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Forma</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Observações</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    Nenhum pagamento registrado.
                  </TableCell>
                </TableRow>
              )}
              {payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{formatDateBR(p.paidAt)}</TableCell>
                  <TableCell>{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</TableCell>
                  <TableCell>{p.account?.name ?? "—"}</TableCell>
                  <TableCell className="max-w-xs truncate">{p.notes ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium text-emerald-600">
                    +{formatBRL(p.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <PaymentDeleteButton id={p.id} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Mobile: histórico de pagamentos em cards */}
          <MobileCards>
            {payments.length === 0 ? (
              <MobileEmpty>Nenhum pagamento registrado.</MobileEmpty>
            ) : (
              payments.map((p) => (
                <MobileCard key={p.id}>
                  <MobileCardHeader
                    title={PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                    aside={
                      <span className="font-semibold text-emerald-600">
                        +{formatBRL(p.amount)}
                      </span>
                    }
                  />
                  <div className="text-xs text-muted-foreground">{formatDateBR(p.paidAt)}</div>
                  <div className="space-y-1.5">
                    <Field label="Conta">{p.account?.name ?? "—"}</Field>
                    <Field label="Observações">{p.notes ?? "—"}</Field>
                  </div>
                  <MobileCardActions>
                    <PaymentDeleteButton id={p.id} />
                  </MobileCardActions>
                </MobileCard>
              ))
            )}
          </MobileCards>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Movimentações do mês</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Desktop: tabela */}
          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Cartão / Conta</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pertence a</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactionsMonth.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Nenhuma movimentação no mês selecionado.
                  </TableCell>
                </TableRow>
              )}
              {transactionsMonth.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{formatDateBR(t.date)}</TableCell>
                  <TableCell className="max-w-[220px] truncate">{t.description}</TableCell>
                  <TableCell>{t.card?.name ?? t.account?.name ?? "—"}</TableCell>
                  <TableCell className="min-w-[160px]">
                    <CategorySelect txId={t.id} value={t.categoryId} categories={categories} />
                  </TableCell>
                  <TableCell className="min-w-[160px]">
                    <ResponsibleInline txId={t.id} value={t.responsibleId} people={people} />
                  </TableCell>
                  <TableCell className="min-w-[140px]">
                    <StatusSelect txId={t.id} value={t.status} />
                    <Badge variant={statusVariant(t.status)} className="hidden">
                      {STATUS_LABEL[t.status] ?? t.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="capitalize">{t.belongsTo}</TableCell>
                  <TableCell className="text-right font-medium">
                    {t.type === "despesa" ? "-" : "+"}
                    {formatBRL(t.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Mobile: movimentações do mês em cards (com edição inline) */}
          <MobileCards>
            {transactionsMonth.length === 0 ? (
              <MobileEmpty>Nenhuma movimentação no mês selecionado.</MobileEmpty>
            ) : (
              transactionsMonth.map((t) => (
                <MobileCard key={t.id}>
                  <MobileCardHeader
                    title={t.description}
                    aside={
                      <span className="font-semibold">
                        {t.type === "despesa" ? "-" : "+"}
                        {formatBRL(t.amount)}
                      </span>
                    }
                  />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDateBR(t.date)}</span>
                    <span aria-hidden>·</span>
                    <span className="capitalize">{t.belongsTo}</span>
                  </div>
                  <div className="space-y-1.5">
                    <Field label="Cartão / Conta">
                      {t.card?.name ?? t.account?.name ?? "—"}
                    </Field>
                  </div>
                  <div className="space-y-2 pt-0.5">
                    <div>
                      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Categoria
                      </p>
                      <CategorySelect txId={t.id} value={t.categoryId} categories={categories} />
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Responsável
                      </p>
                      <ResponsibleInline txId={t.id} value={t.responsibleId} people={people} />
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Status
                      </p>
                      <StatusSelect txId={t.id} value={t.status} />
                    </div>
                  </div>
                </MobileCard>
              ))
            )}
          </MobileCards>
        </CardContent>
      </Card>
    </div>
  );
}
