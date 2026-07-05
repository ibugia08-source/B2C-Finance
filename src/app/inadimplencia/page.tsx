import { PageHeader } from "@/components/page-header";
import { CobrancasTabs } from "@/app/cobrancas/module-tabs";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, monthRange } from "@/lib/format";
import {
  markOverdueBillings,
  getDelinquentClients,
  type AgingBucket,
} from "@/lib/services/billing-metrics";
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
import { Button } from "@/components/ui/button";
import {
  MobileCards,
  MobileCard,
  MobileCardHeader,
  MobileCardActions,
  Field,
  MobileEmpty,
} from "@/components/ui/record-card";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/viewer";
import { MessageDialog } from "@/app/cobrancas/message-dialog";
import { COLLECTION_STATUS_LABEL } from "@/app/cobrancas/_meta";
import { MessageSquareText } from "lucide-react";

const BUCKET_META: Record<AgingBucket, { label: string; variant: any }> = {
  "1-15": { label: "1–15 dias", variant: "warning" },
  "16-30": { label: "16–30 dias", variant: "warning" },
  "31-60": { label: "31–60 dias", variant: "destructive" },
  "60+": { label: "60+ dias", variant: "destructive" },
};

export default async function InadimplenciaPage() {
  await requireAdmin();
  await markOverdueBillings();

  const { start, end } = monthRange();
  const [clients, recoveredAgg] = await Promise.all([
    getDelinquentClients(),
    // Recuperação: receitas RECOVERY recebidas no mês (pagamento de vencidas)
    prisma.income.aggregate({
      where: {
        revenueType: "RECOVERY",
        status: "RECEIVED",
        receivedAt: { gte: start, lt: end },
      },
      _sum: { amount: true },
    }),
  ]);

  const totalVencido = clients.reduce((s, c) => s + c.totalOverdue, 0);
  const recuperado = Number(recoveredAgg._sum.amount ?? 0);
  const buckets = clients.reduce(
    (acc, c) => ((acc[c.bucket] = (acc[c.bucket] ?? 0) + c.totalOverdue), acc),
    {} as Record<AgingBucket, number>
  );

  return (
    <div>
      <PageHeader
        title="Inadimplência"
        description="Clientes com cobranças vencidas e recuperação"
        actions={
          <Button variant="outline" asChild>
            <Link href="/cobrancas">← Cobranças</Link>
          </Button>
        }
      />

      <CobrancasTabs active="/inadimplencia" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard title="Total vencido" value={formatBRL(totalVencido)}
          intent={totalVencido > 0 ? "negative" : "positive"} />
        <StatCard title="Clientes inadimplentes" value={String(clients.length)}
          intent={clients.length > 0 ? "negative" : "positive"} />
        <StatCard title="Recuperado no mês" value={formatBRL(recuperado)} intent="positive"
          hint="pagamentos de cobranças vencidas" />
        <StatCard
          title="Crítico (31+ dias)"
          value={formatBRL((buckets["31-60"] ?? 0) + (buckets["60+"] ?? 0))}
          intent={(buckets["31-60"] ?? 0) + (buckets["60+"] ?? 0) > 0 ? "negative" : "default"}
        />
      </div>

      {/* Aging */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        {(Object.keys(BUCKET_META) as AgingBucket[]).map((b) => (
          <Card key={b}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {BUCKET_META[b].label}
              </p>
              <p className="text-lg font-bold mt-1">{formatBRL(buckets[b] ?? 0)}</p>
              <p className="text-xs text-muted-foreground">
                {clients.filter((c) => c.bucket === b).length} cliente(s)
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Total vencido</TableHead>
                  <TableHead>Cobranças</TableHead>
                  <TableHead>Vencida mais antiga</TableHead>
                  <TableHead>Atraso</TableHead>
                  <TableHead>Último contato</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                      🎉 Nenhum cliente inadimplente no momento.
                    </TableCell>
                  </TableRow>
                )}
                {clients.map((c) => (
                  <TableRow key={c.clientId}>
                    <TableCell>
                      <Link href={`/clientes/${c.clientId}`} className="font-medium hover:underline">
                        {c.clientName}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right font-medium text-red-600">
                      {formatBRL(c.totalOverdue)}
                    </TableCell>
                    <TableCell>{c.billingCount}</TableCell>
                    <TableCell>{formatDateBR(c.oldestDueDate)}</TableCell>
                    <TableCell>
                      <Badge variant={BUCKET_META[c.bucket].variant}>
                        {c.daysOverdue} dias
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.lastContactAt
                        ? `${formatDateBR(c.lastContactAt)} · ${COLLECTION_STATUS_LABEL[c.lastContactStatus ?? ""] ?? ""}`
                        : "nunca contatado"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <MessageDialog
                          input={{
                            clientName: c.clientName,
                            openAmount: formatBRL(c.totalOverdue),
                            dueDate: formatDateBR(c.oldestDueDate),
                            daysOverdue: c.daysOverdue,
                            serviceNames: [],
                            hasPromise: c.lastContactStatus === "PROMISED",
                            contactCount: c.lastContactAt ? 1 : 0,
                          }}
                          phone={c.phone}
                          trigger={
                            <Button variant="outline" size="sm">
                              <MessageSquareText className="h-4 w-4 mr-1" /> Cobrar
                            </Button>
                          }
                        />
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/cobrancas?cliente=${c.clientId}&status=OVERDUE`}>
                            Ver cobranças
                          </Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <MobileCards>
            {clients.length === 0 ? (
              <MobileEmpty>🎉 Nenhum cliente inadimplente no momento.</MobileEmpty>
            ) : (
              clients.map((c) => (
                <MobileCard key={c.clientId}>
                  <MobileCardHeader
                    title={c.clientName}
                    aside={
                      <span className="font-semibold text-red-600">
                        {formatBRL(c.totalOverdue)}
                      </span>
                    }
                  />
                  <div className="space-y-1.5">
                    <Field label="Atraso">
                      <Badge variant={BUCKET_META[c.bucket].variant}>
                        {c.daysOverdue} dias
                      </Badge>
                    </Field>
                    <Field label="Cobranças">{c.billingCount}</Field>
                    <Field label="Último contato">
                      {c.lastContactAt ? formatDateBR(c.lastContactAt) : "nunca"}
                    </Field>
                  </div>
                  <MobileCardActions>
                    <MessageDialog
                      input={{
                        clientName: c.clientName,
                        openAmount: formatBRL(c.totalOverdue),
                        dueDate: formatDateBR(c.oldestDueDate),
                        daysOverdue: c.daysOverdue,
                        serviceNames: [],
                        hasPromise: c.lastContactStatus === "PROMISED",
                        contactCount: c.lastContactAt ? 1 : 0,
                      }}
                      phone={c.phone}
                      trigger={
                        <Button variant="outline" size="sm">
                          <MessageSquareText className="h-4 w-4 mr-1" /> Cobrar
                        </Button>
                      }
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
