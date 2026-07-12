import { PageHeader } from "@/components/page-header";
import { SavedViews } from "@/components/saved-views";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthRange, parseMonthParam } from "@/lib/format";
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
import { IncomeDialog } from "./income-dialog";
import { IncomeActions } from "./row-actions";
import { IncomeFilters } from "./filters";
import { getViewer } from "@/lib/auth/viewer";

type Search = {
  mes?: string;
  status?: string;
  origem?: string;
  pessoa?: string;
};

const SOURCE_LABEL: Record<string, string> = {
  BANK_ACCOUNT: "Conta bancária",
  PIX: "Pix",
  TRANSFER: "Transferência",
  CASH: "Dinheiro",
};

const TYPE_LABEL: Record<string, string> = {
  SALARY: "Salário",
  EARNINGS: "Rendimentos",
  COMPANY_WITHDRAWAL: "Retirada da empresa",
  SALE: "Venda",
  OTHER: "Outro",
  // Legados
  CLIENT: "Cliente",
  REIMBURSEMENT: "Reembolso",
  LOAN_RECEIVED: "Empréstimo recebido",
};

const STATUS_LABEL: Record<string, string> = {
  RECEIVED: "Recebido",
  EXPECTED: "Previsto",
  LATE: "Atrasado",
  CANCELED: "Cancelado",
};

function statusVariant(s: string): any {
  if (s === "RECEIVED") return "success";
  if (s === "LATE") return "destructive";
  if (s === "EXPECTED") return "warning";
  return "secondary";
}

export default async function ReceitasPage({ searchParams }: { searchParams: Search }) {
  await getViewer();
  const where: any = {};
  const mesParam = parseMonthParam(searchParams.mes);
  if (mesParam) {
    const ref = new Date(mesParam.year, mesParam.month - 1, 1);
    const { start, end } = monthRange(ref);
    where.receivedAt = { gte: start, lt: end };
  }
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.origem) where.sourceType = searchParams.origem;
  if (searchParams.pessoa) where.personId = searchParams.pessoa;

  const [incomes, accounts, people, categories, clients, contracts] =
    await Promise.all([
      prisma.income.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        include: { account: true, person: true, category: true },
        take: 200,
      }),
      prisma.account.findMany({ orderBy: { name: "asc" } }),
      prisma.person.findMany({ orderBy: { name: "asc" } }),
      prisma.category.findMany({
        where: { kind: { in: ["receita", "mista"] } },
        orderBy: { name: "asc" },
      }),
      prisma.client.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.contract.findMany({
        orderBy: { title: "asc" },
        select: { id: true, title: true, clientId: true },
      }),
    ]);

  // Totais dos cards seguem o período selecionado no filtro (ou mês atual)
  let ref = new Date();
  if (mesParam) ref = new Date(mesParam.year, mesParam.month - 1, 1);
  const { start, end } = monthRange(ref);
  const [monthIncomes, extraRevenues] = await Promise.all([
    prisma.income.findMany({
      where: { receivedAt: { gte: start, lt: end } },
      select: { amount: true, status: true },
    }),
    // Receita Extra é APENAS manual (lançamentos avulsos do usuário).
    // Recuperações de inadimplência ficam registradas nos pagamentos.
    prisma.extraRevenue.findMany({
      where: { receivedAt: { gte: start, lt: end }, origin: "MANUAL" },
      orderBy: { receivedAt: "desc" },
      include: { client: { select: { id: true, name: true } } },
    }),
  ]);
  const totalExtra = extraRevenues.reduce((s, e) => s + Number(e.amount), 0);
  const totalRecebido = monthIncomes
    .filter((i) => i.status === "RECEIVED")
    .reduce((s, i) => s + i.amount, 0);
  const totalPrevisto = monthIncomes
    .filter((i) => i.status === "EXPECTED")
    .reduce((s, i) => s + i.amount, 0);
  const totalAtrasado = monthIncomes
    .filter((i) => i.status === "LATE")
    .reduce((s, i) => s + i.amount, 0);

  return (
    <div>
      <PageHeader
        title="Receitas"
        description="Receitas extras da operação (upsell, vendas avulsas) — as receitas de contratos entram automaticamente pelas cobranças"
        actions={
          <IncomeDialog
            accounts={accounts}
            people={people}
            categories={categories}
            clients={clients}
            contracts={contracts}
          />
        }
      />

      <div className="mb-3 print:hidden">
        <SavedViews module="receitas" />
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <IncomeFilters people={people} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <StatCard title="Recebido no mês" value={formatBRL(totalRecebido)} intent="positive" />
        <StatCard title="Previsto no mês" value={formatBRL(totalPrevisto)} intent="warning" />
        <StatCard title="Atrasado" value={formatBRL(totalAtrasado)} intent="negative" />
        <StatCard
          title="Receita Extra (manual)"
          value={formatBRL(totalExtra)}
          intent={totalExtra > 0 ? "positive" : "default"}
          hint="entradas avulsas cadastradas manualmente"
        />
      </div>

      {extraRevenues.length > 0 && (
        <Card className="mb-4 border-blue-200 dark:border-blue-500/30">
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-blue-700 dark:text-blue-400 font-medium mb-2">
              Receita Extra — lançamentos manuais do mês
            </p>
            <ul className="space-y-1.5 text-sm">
              {extraRevenues.map((e) => (
                <li key={e.id} className="flex flex-wrap justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {e.client ? (
                      <a href={`/clientes/${e.client.id}`} className="font-medium hover:underline">
                        {e.client.name}
                      </a>
                    ) : (
                      <span className="font-medium">—</span>
                    )}{" "}
                    <span className="text-muted-foreground">
                      · competência original{" "}
                      {e.originalReferenceMonth
                        ? `${String(e.originalReferenceMonth).padStart(2, "0")}/${e.originalReferenceYear}`
                        : "—"}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-muted-foreground">
                    recebido {formatDateBR(e.receivedAt)} ·{" "}
                    <strong className="text-emerald-600">{formatBRL(Number(e.amount))}</strong>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground mt-2">
              Geradas automaticamente quando uma cobrança de competência anterior é paga
              em mês posterior — o mês original permanece inadimplente no fechamento.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {/* Desktop: tabela completa */}
          <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Conta</TableHead>
                <TableHead>Pessoa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {incomes.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-10">
                    <img
                      src="/brand/empty-receitas.svg"
                      alt=""
                      className="mx-auto mb-3 w-56 max-w-full opacity-95"
                    />
                    Nenhuma receita registrada neste período. Adicione uma entrada para começar.
                  </TableCell>
                </TableRow>
              )}
              {incomes.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{formatDateBR(i.receivedAt)}</TableCell>
                  <TableCell className="max-w-xs truncate">{i.description}</TableCell>
                  <TableCell>{TYPE_LABEL[i.incomeType] ?? i.incomeType}</TableCell>
                  <TableCell>{SOURCE_LABEL[i.sourceType] ?? i.sourceType}</TableCell>
                  <TableCell>{i.account?.name ?? "—"}</TableCell>
                  <TableCell>{i.person?.name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(i.status)}>
                      {STATUS_LABEL[i.status] ?? i.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium text-emerald-600">
                    +{formatBRL(i.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <IncomeActions
                      income={i}
                      accounts={accounts}
                      people={people}
                      categories={categories}
                      clients={clients}
                      contracts={contracts}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Mobile: cada receita vira um card */}
          <MobileCards>
            {incomes.length === 0 ? (
              <MobileEmpty>
                <img
                  src="/brand/empty-receitas.svg"
                  alt=""
                  className="mx-auto mb-3 w-44 max-w-full opacity-95"
                />
                Nenhuma receita registrada neste período. Adicione uma entrada para começar.
              </MobileEmpty>
            ) : (
              incomes.map((i) => (
                <MobileCard key={i.id}>
                  <MobileCardHeader
                    title={i.description}
                    aside={
                      <span className="font-semibold text-emerald-600">
                        +{formatBRL(i.amount)}
                      </span>
                    }
                  />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDateBR(i.receivedAt)}</span>
                    <span aria-hidden>·</span>
                    <span>{TYPE_LABEL[i.incomeType] ?? i.incomeType}</span>
                    <Badge variant={statusVariant(i.status)}>
                      {STATUS_LABEL[i.status] ?? i.status}
                    </Badge>
                  </div>
                  <div className="space-y-1.5">
                    <Field label="Origem">{SOURCE_LABEL[i.sourceType] ?? i.sourceType}</Field>
                    <Field label="Conta">{i.account?.name ?? "—"}</Field>
                    <Field label="Pessoa">{i.person?.name ?? "—"}</Field>
                  </div>
                  <MobileCardActions>
                    <IncomeActions
                      income={i}
                      accounts={accounts}
                      people={people}
                      categories={categories}
                      clients={clients}
                      contracts={contracts}
                    />
                  </MobileCardActions>
                </MobileCard>
              ))
            )}
          </MobileCards>
        </CardContent>
      </Card>
    </div>
  );
}
