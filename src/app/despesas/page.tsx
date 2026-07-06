import { PageHeader } from "@/components/page-header";
import { SavedViews } from "@/components/saved-views";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthRange, monthLabel } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
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
import { ExpenseDialog } from "./expense-dialog";
import { ExpenseActions } from "./row-actions";
import { ExpenseFilters } from "./filters";
import { getViewer } from "@/lib/auth/viewer";

type Search = { mes?: string; status?: string; pessoa?: string };

const ORIGIN_LABEL: Record<string, string> = {
  debito: "Débito",
  pix: "Pix",
  dinheiro: "Dinheiro",
  boleto: "Boleto",
  cartao: "Cartão",
};

function parseMonthRef(mes?: string): Date {
  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [y, m] = mes.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }
  return new Date();
}

function statusInfo(status: string, dueDate: Date | null): { label: string; variant: any } {
  if (status === "pago") return { label: "Pago", variant: "success" };
  if (status === "cancelado") return { label: "Cancelado", variant: "outline" };
  // pendente
  if (dueDate && dueDate < new Date()) return { label: "Atrasado", variant: "destructive" };
  return { label: "A vencer", variant: "warning" };
}

export default async function DespesasPage({ searchParams }: { searchParams: Search }) {
  await getViewer();

  const ref = parseMonthRef(searchParams.mes);
  const { start, end } = monthRange(ref);

  // Base: despesas manuais (sem cartão de crédito) do mês de referência
  const monthWhere: any = {
    type: "despesa",
    cardId: null,
    date: { gte: start, lt: end },
  };

  const tableWhere: any = { ...monthWhere };
  if (searchParams.status) tableWhere.status = searchParams.status;
  if (searchParams.pessoa) tableWhere.responsibleId = searchParams.pessoa;

  const [monthExpenses, expenses, people, categories, accounts, clients, services] = await Promise.all([
    prisma.transaction.findMany({
      where: monthWhere,
      select: { amount: true, status: true },
    }),
    prisma.transaction.findMany({
      where: tableWhere,
      orderBy: { date: "desc" },
      include: { category: true, responsible: true, account: true, installments: true },
      take: 300,
    }),
    prisma.person.findMany({ orderBy: { name: "asc" } }),
    prisma.category.findMany({
      where: { kind: { in: ["despesa", "mista"] } },
      orderBy: { name: "asc" },
    }),
    prisma.account.findMany({ orderBy: { name: "asc" } }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.service.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);

  const totalMes = monthExpenses
    .filter((e) => e.status !== "cancelado")
    .reduce((s, e) => s + e.amount, 0);
  const totalPago = monthExpenses
    .filter((e) => e.status === "pago")
    .reduce((s, e) => s + e.amount, 0);
  const totalPendente = monthExpenses
    .filter((e) => e.status === "pendente")
    .reduce((s, e) => s + e.amount, 0);
  const qtd = monthExpenses.filter((e) => e.status !== "cancelado").length;

  return (
    <div>
      <PageHeader
        title="Despesas"
        description={`Despesas da agência (débito, pix, dinheiro…) · ${monthLabel(ref)}`}
        actions={
          <ExpenseDialog people={people} categories={categories} accounts={accounts} clients={clients} services={services} />
        }
      />

      <div className="mb-3 print:hidden">
        <SavedViews module="despesas" />
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <ExpenseFilters people={people} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard title="Total de despesas" value={formatBRL(totalMes)} intent="negative" />
        <StatCard title="Nº de despesas" value={String(qtd)} />
        <StatCard title="Pagas" value={formatBRL(totalPago)} intent="positive" />
        <StatCard title="A vencer" value={formatBRL(totalPendente)} intent="warning" />
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Desktop: tabela completa */}
          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Forma</TableHead>
                <TableHead>Pessoa</TableHead>
                <TableHead>Parcelas</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {expenses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground py-10">
                    Nenhuma despesa neste período. Adicione sua primeira despesa.
                  </TableCell>
                </TableRow>
              )}
              {expenses.map((e) => {
                const st = statusInfo(e.status, e.dueDate);
                const parc = e.installments.length;
                return (
                  <TableRow key={e.id}>
                    <TableCell>{formatDateBR(e.date)}</TableCell>
                    <TableCell className="max-w-xs truncate">{e.description}</TableCell>
                    <TableCell>{e.category?.name ?? "—"}</TableCell>
                    <TableCell>{ORIGIN_LABEL[e.origin] ?? e.origin}</TableCell>
                    <TableCell>{e.responsible?.name ?? "—"}</TableCell>
                    <TableCell>{parc > 1 ? `${parc}x` : "à vista"}</TableCell>
                    <TableCell>{e.dueDate ? formatDateBR(e.dueDate) : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium text-red-600 dark:text-red-400">
                      -{formatBRL(e.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ExpenseActions
                        expense={{ ...e, installmentsCount: parc }}
                        people={people}
                        categories={categories}
                        accounts={accounts}
                        clients={clients}
                        services={services}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>

          {/* Mobile: cada despesa vira um card */}
          <MobileCards>
            {expenses.length === 0 ? (
              <MobileEmpty>
                Nenhuma despesa neste período. Adicione sua primeira despesa.
              </MobileEmpty>
            ) : (
              expenses.map((e) => {
                const st = statusInfo(e.status, e.dueDate);
                const parc = e.installments.length;
                return (
                  <MobileCard key={e.id}>
                    <MobileCardHeader
                      title={e.description}
                      aside={
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          -{formatBRL(e.amount)}
                        </span>
                      }
                    />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                      <span>{formatDateBR(e.date)}</span>
                      <span aria-hidden>·</span>
                      <span>{e.category?.name ?? "—"}</span>
                      <Badge variant={st.variant}>{st.label}</Badge>
                    </div>
                    <div className="space-y-1.5">
                      <Field label="Forma">{ORIGIN_LABEL[e.origin] ?? e.origin}</Field>
                      <Field label="Pessoa">{e.responsible?.name ?? "—"}</Field>
                      <Field label="Parcelas">{parc > 1 ? `${parc}x` : "à vista"}</Field>
                      <Field label="Vencimento">
                        {e.dueDate ? formatDateBR(e.dueDate) : "—"}
                      </Field>
                    </div>
                    <MobileCardActions>
                      <ExpenseActions
                        expense={{ ...e, installmentsCount: parc }}
                        people={people}
                        categories={categories}
                        accounts={accounts}
                        clients={clients}
                        services={services}
                      />
                    </MobileCardActions>
                  </MobileCard>
                );
              })
            )}
          </MobileCards>
        </CardContent>
      </Card>
    </div>
  );
}
