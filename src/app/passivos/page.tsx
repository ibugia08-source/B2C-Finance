import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR } from "@/lib/format";
import { getBalanceSummary } from "@/lib/services/finance-metrics";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/viewer";
import {
  LiabilityDialog, LiabilityActions, LoanDialog, LoanActions,
} from "./liability-dialogs";
import { LIABILITY_TYPE_LABEL } from "./_meta";

export default async function PassivosPage() {
  await requireAdmin();
  await markOverdueBillings();

  const [balance, liabilitiesRaw, loansRaw] = await Promise.all([
    getBalanceSummary(),
    prisma.liability.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
    prisma.loan.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  const liabilities = liabilitiesRaw.map((l) => ({
    ...l,
    totalValue: Number(l.totalValue),
    remainingValue: Number(l.remainingValue),
    monthlyPayment: l.monthlyPayment != null ? Number(l.monthlyPayment) : null,
  }));
  const loans = loansRaw.map((l) => ({
    ...l,
    principal: Number(l.principal),
    interestRate: l.interestRate != null ? Number(l.interestRate) : null,
    installmentValue: l.installmentValue != null ? Number(l.installmentValue) : null,
    remainingValue: l.remainingValue != null ? Number(l.remainingValue) : null,
  }));

  return (
    <div>
      <PageHeader
        title="Passivos"
        description="O que a agência deve"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" asChild><Link href="/ativos">← Ativos</Link></Button>
            <LoanDialog />
            <LiabilityDialog />
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <StatCard title="Contas a pagar" value={formatBRL(balance.contasAPagar)}
          hint="despesas pendentes" />
        <StatCard title="Faturas de cartão" value={formatBRL(balance.faturasCartao)} />
        <StatCard title="Dívidas cadastradas" value={formatBRL(balance.passivosManuais)} />
        <StatCard title="PASSIVOS TOTAIS" value={formatBRL(balance.passivosTotais)} intent="negative" />
        <StatCard
          title="Saldo patrimonial"
          value={formatBRL(balance.saldoPatrimonial)}
          intent={balance.saldoPatrimonial >= 0 ? "positive" : "negative"}
          hint="ativos − passivos"
        />
      </div>

      <Card className="mb-4">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Passivo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Saldo devedor</TableHead>
                <TableHead className="text-right">Parcela/mês</TableHead>
                <TableHead>Venc. final</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {liabilities.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                    Nenhum passivo cadastrado. Contas a pagar e faturas de cartão já
                    entram automaticamente — cadastre aqui empréstimos, parcelamentos,
                    impostos e obrigações futuras.
                  </TableCell>
                </TableRow>
              )}
              {liabilities.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell>{LIABILITY_TYPE_LABEL[l.type] ?? l.type}</TableCell>
                  <TableCell className="text-right">{formatBRL(l.totalValue)}</TableCell>
                  <TableCell className="text-right font-medium text-red-600">
                    {formatBRL(l.remainingValue)}
                  </TableCell>
                  <TableCell className="text-right">
                    {l.monthlyPayment != null ? formatBRL(l.monthlyPayment) : "—"}
                  </TableCell>
                  <TableCell>{l.dueDate ? formatDateBR(l.dueDate) : "—"}</TableCell>
                  <TableCell className="text-right"><LiabilityActions liability={l} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
        Empréstimos (detalhe)
      </h2>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Credor</TableHead>
                <TableHead className="text-right">Principal</TableHead>
                <TableHead className="text-right">Juros a.m.</TableHead>
                <TableHead>Parcelas</TableHead>
                <TableHead className="text-right">Parcela</TableHead>
                <TableHead className="text-right">Saldo devedor</TableHead>
                <TableHead>1º venc.</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loans.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                    Nenhum empréstimo registrado.
                  </TableCell>
                </TableRow>
              )}
              {loans.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.lender}</TableCell>
                  <TableCell className="text-right">{formatBRL(l.principal)}</TableCell>
                  <TableCell className="text-right">
                    {l.interestRate != null ? `${(l.interestRate * 100).toFixed(2)}%` : "—"}
                  </TableCell>
                  <TableCell>{l.installments}x</TableCell>
                  <TableCell className="text-right">
                    {l.installmentValue != null ? formatBRL(l.installmentValue) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium text-red-600">
                    {l.remainingValue != null ? formatBRL(l.remainingValue) : "—"}
                  </TableCell>
                  <TableCell>{l.firstDueDate ? formatDateBR(l.firstDueDate) : "—"}</TableCell>
                  <TableCell className="text-right"><LoanActions loan={l} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
