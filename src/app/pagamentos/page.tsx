import { PageHeader } from "@/components/page-header";
import { CobrancasTabs } from "@/app/cobrancas/module-tabs";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, monthRange, parseMonthParam } from "@/lib/format";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/viewer";
import { PaymentsTable, type PaymentRow } from "./payments-table";
import { PAYMENT_METHOD_LABEL } from "@/app/cobrancas/_meta";

type Search = { mes?: string; metodo?: string; cliente?: string };

export default async function PagamentosPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  await requireAdmin();
  await markOverdueBillings();

  let ref = new Date();
  const mesParam = parseMonthParam(searchParams.mes);
  if (mesParam) ref = new Date(mesParam.year, mesParam.month - 1, 1);
  const { start, end } = monthRange(ref);

  const where: any = { paidAt: { gte: start, lt: end } };
  if (searchParams.metodo) where.method = searchParams.metodo;
  if (searchParams.cliente) where.billing = { clientId: searchParams.cliente };

  const [paymentsRaw, clients, byMethod] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { paidAt: "desc" },
      take: 300,
      include: {
        billing: {
          select: {
            description: true,
            client: { select: { id: true, name: true } },
          },
        },
        account: { select: { name: true } },
      },
    }),
    prisma.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.payment.groupBy({
      by: ["method"],
      where: { paidAt: { gte: start, lt: end }, status: "CONFIRMED" },
      _sum: { amount: true },
    }),
  ]);

  const payments = paymentsRaw.map((p) => ({ ...p, amount: Number(p.amount) }));
  const total = payments.reduce((s, p) => s + p.amount, 0);

  const paymentRows: PaymentRow[] = payments.map((p) => ({
    id: p.id,
    paidAt: p.paidAt.toISOString(),
    amount: p.amount,
    method: p.method,
    clientId: p.billing.client.id,
    clientName: p.billing.client.name,
    description: p.billing.description,
    accountName: p.account?.name ?? null,
  }));
  const topMethod = byMethod.sort(
    (a, b) => Number(b._sum.amount ?? 0) - Number(a._sum.amount ?? 0)
  )[0];

  const monthValue = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;

  return (
    <div>
      <PageHeader
        title="Pagamentos"
        description="Recebimentos de cobranças (caixa)"
        actions={
          <Button variant="outline" asChild>
            <Link href="/cobrancas">← Cobranças</Link>
          </Button>
        }
      />

      <CobrancasTabs active="/pagamentos" />

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <StatCard title="Recebido no mês" value={formatBRL(total)} intent="positive" />
        <StatCard title="Pagamentos" value={String(payments.length)} />
        <StatCard
          title="Principal forma"
          value={topMethod ? PAYMENT_METHOD_LABEL[topMethod.method] : "—"}
          hint={topMethod ? formatBRL(Number(topMethod._sum.amount)) : undefined}
        />
      </div>

      <Card className="mb-4">
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <form className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Mês</label>
              <input
                type="month"
                name="mes"
                defaultValue={searchParams.mes ?? monthValue}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Forma</label>
              <select
                name="metodo"
                defaultValue={searchParams.metodo ?? ""}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todas</option>
                {Object.entries(PAYMENT_METHOD_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Cliente</label>
              <select
                name="cliente"
                defaultValue={searchParams.cliente ?? ""}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Todos</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <Button type="submit" variant="outline">Filtrar</Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <PaymentsTable rows={paymentRows} />
        </CardContent>
      </Card>
    </div>
  );
}
