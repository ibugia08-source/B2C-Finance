import { PageHeader } from "@/components/page-header";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CategoryDialog } from "@/app/configuracoes/category-dialog";
import { PieChart } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthRange, parseMonthParam } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import { Filters } from "./filters";
import { getViewer } from "@/lib/auth/viewer";

type Search = {
  mes?: string;
  pessoa?: string;
  cartao?: string;
  categoria?: string;
  status?: string;
  tipo?: string;
};

function statusVariant(status: string): any {
  switch (status) {
    case "pago":
      return "success";
    case "devendo":
      return "destructive";
    case "reembolsado":
      return "secondary";
    case "cancelado":
      return "outline";
    default:
      return "warning";
  }
}

export default async function TransacoesPage({ searchParams }: { searchParams: Search }) {
  await getViewer("/transacoes");

  // Isolamento por dono é automático (extensão do Prisma).
  const where: any = {};

  const mesParam = parseMonthParam(searchParams.mes);
  if (mesParam) {
    const ref = new Date(mesParam.year, mesParam.month - 1, 1);
    const { start, end } = monthRange(ref);
    where.date = { gte: start, lt: end };
  }
  if (searchParams.pessoa) where.responsibleId = searchParams.pessoa;
  if (searchParams.cartao) where.cardId = searchParams.cartao;
  if (searchParams.categoria) where.categoryId = searchParams.categoria;
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.tipo) where.type = searchParams.tipo;

  const [transactions, cards, people, categories] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
      include: { card: true, category: true, responsible: true, account: true },
      take: 200,
    }),
    prisma.creditCard.findMany({ orderBy: { name: "asc" } }),
    prisma.person.findMany({ orderBy: { name: "asc" } }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div>
      <PageHeader
        title="Movimentações"
        description="Movimentações das contas e cartões da agência."
        actions={
          <div className="flex flex-wrap gap-2">
            <CategoryDialog />
            <Button variant="outline" size="sm" asChild>
              <Link href="/relatorios/despesas?agrupar=categoria&periodo=mes">
                <PieChart className="h-4 w-4 mr-1" /> Gastos por categoria
              </Link>
            </Button>
          </div>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-4">
          <Filters cards={cards} people={people} categories={categories} />
        </CardContent>
      </Card>

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
                <TableHead>Cartão / Conta</TableHead>
                <TableHead>Pessoa</TableHead>
                <TableHead>Pertence a</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    Nenhuma transação encontrada.
                  </TableCell>
                </TableRow>
              )}
              {transactions.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{formatDateBR(t.date)}</TableCell>
                  <TableCell className="max-w-xs truncate">{t.description}</TableCell>
                  <TableCell>{t.category?.name ?? "—"}</TableCell>
                  <TableCell>{t.card?.name ?? t.account?.name ?? "—"}</TableCell>
                  <TableCell>{t.responsible?.name ?? "—"}</TableCell>
                  <TableCell className="capitalize">{t.belongsTo}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                  </TableCell>
                  <TableCell className={`text-right font-medium ${t.type === "receita" ? "text-emerald-600" : ""}`}>
                    {t.type === "despesa" ? "-" : "+"}
                    {formatBRL(t.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>

          {/* Mobile: cada movimentação vira um card */}
          <MobileCards>
            {transactions.length === 0 ? (
              <MobileEmpty>Nenhuma transação encontrada.</MobileEmpty>
            ) : (
              transactions.map((t) => (
                <MobileCard key={t.id}>
                  <MobileCardHeader
                    title={t.description}
                    aside={
                      <span
                        className={`font-semibold ${
                          t.type === "receita" ? "text-emerald-600" : ""
                        }`}
                      >
                        {t.type === "despesa" ? "-" : "+"}
                        {formatBRL(t.amount)}
                      </span>
                    }
                  />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatDateBR(t.date)}</span>
                    <span aria-hidden>·</span>
                    <span>{t.category?.name ?? "—"}</span>
                    <Badge variant={statusVariant(t.status)}>{t.status}</Badge>
                  </div>
                  <div className="space-y-1.5">
                    <Field label="Cartão / Conta">
                      {t.card?.name ?? t.account?.name ?? "—"}
                    </Field>
                    <Field label="Pessoa">{t.responsible?.name ?? "—"}</Field>
                    <Field label="Pertence a">
                      <span className="capitalize">{t.belongsTo}</span>
                    </Field>
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
