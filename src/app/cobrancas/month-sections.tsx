import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL } from "@/lib/format";
import {
  incomeStatusMeta,
  expenseStatusMeta,
  payrollStatusMeta,
  type StatusMeta,
} from "@/lib/status-meta";
import { MarkExpensePaid } from "@/app/rotina/expense-actions";
import { RenewClientDialog } from "@/app/clientes/renew-dialog";
import { ClientLossDialog } from "@/app/clientes/loss-dialog";
import {
  EntradaQuickDialog,
  ContaQuickDialog,
  PagarFolhaButton,
} from "./quick-dialogs";
import { CLIENT_STATUS_LABEL, clientStatusVariant } from "@/app/clientes/_meta";

/**
 * Seções da GESTÃO DO MÊS — os blocos da aba mensal da planilha, cada um
 * com os dados já resolvidos pela página (fases sequenciais; nenhuma query
 * aqui). Toda seção segue o mesmo esqueleto: título âncora + total + ação.
 */

function SectionShell({
  id,
  title,
  subtitle,
  action,
  children,
}: {
  id: string;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-6 scroll-mt-20">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">
            {title}
          </h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function StatusBadge({ meta }: { meta: StatusMeta }) {
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
}

// ===== Navegação de seções (âncoras no topo, estilo planilha) =====

export function SectionNav({
  items,
}: {
  items: { href: string; label: string; count?: number | null }[];
}) {
  return (
    <nav
      aria-label="Seções do mês"
      className="mb-4 flex flex-wrap items-center gap-1.5 print:hidden"
    >
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-primary/40"
        >
          {it.label}
          {it.count != null && (
            <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">
              {it.count}
            </span>
          )}
        </a>
      ))}
    </nav>
  );
}

// ===== Outras Entradas =====

export type EntradaRow = {
  id: string;
  description: string;
  clientName: string | null;
  amount: number;
  dateBR: string;
  status: string; // Income.status
  isRecovery: boolean;
  recoveryOf: string | null; // "MM/AAAA" da competência recuperada
};

export function EntradasSection({
  rows,
  total,
  canCreate,
  month,
  year,
}: {
  rows: EntradaRow[];
  total: number;
  canCreate: boolean;
  month: number;
  year: number;
}) {
  return (
    <SectionShell
      id="entradas"
      title="Outras Entradas"
      subtitle="Entradas fora das mensalidades + recuperações de inadimplência recebidas no mês"
      action={
        <div className="flex items-center gap-2">
          <Link
            href={`/receitas?mes=${year}-${String(month).padStart(2, "0")}`}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            histórico completo
          </Link>
          {canCreate && <EntradaQuickDialog month={month} year={year} />}
        </div>
      }
    >
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Nenhuma entrada avulsa neste mês.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const meta = incomeStatusMeta(r.status);
                  return (
                    <TableRow key={r.id} className={meta.rowClass}>
                      <TableCell className="max-w-[340px]">
                        <span className="block truncate font-medium">
                          {r.description}
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {r.clientName && <span>{r.clientName}</span>}
                          {r.isRecovery && (
                            <Badge variant="outline" className="text-[10px]">
                              recuperação{r.recoveryOf ? ` de ${r.recoveryOf}` : ""}
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">{r.dateBR}</TableCell>
                      <TableCell>
                        <StatusBadge meta={meta} />
                      </TableCell>
                      <TableCell className="text-right stat-number">
                        {formatBRL(r.amount)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={3}>Total recebido no mês</TableCell>
                  <TableCell className="text-right stat-number">
                    {formatBRL(total)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </SectionShell>
  );
}

// ===== Contas a Pagar =====

export type ContaRow = {
  id: string;
  description: string;
  categoryName: string | null;
  typeLabel: string | null;
  amount: number;
  dueBR: string | null;
  dueDate: Date | null;
  status: string | null;
};

export function ContasSection({
  rows,
  total,
  paidTotal,
  canPay,
  canCreate,
  categories,
  month,
  year,
}: {
  rows: ContaRow[];
  total: number;
  paidTotal: number;
  canPay: boolean;
  canCreate: boolean;
  categories: { id: string; name: string }[];
  month: number;
  year: number;
}) {
  return (
    <SectionShell
      id="contas"
      title="Contas a Pagar"
      subtitle={`Pago ${formatBRL(paidTotal)} de ${formatBRL(total)} no mês`}
      action={
        <div className="flex items-center gap-2">
          <Link
            href={`/despesas?mes=${year}-${String(month).padStart(2, "0")}`}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            despesas &amp; cartões
          </Link>
          {canCreate && (
            <ContaQuickDialog month={month} year={year} categories={categories} />
          )}
        </div>
      }
    >
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Nenhuma conta lançada neste mês.
            </p>
          ) : (
            <Table containerClassName="max-h-[52vh]">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  {canPay && <TableHead className="w-10" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const meta = expenseStatusMeta(r.status, r.dueDate);
                  return (
                    <TableRow key={r.id} className={meta.rowClass}>
                      <TableCell className="max-w-[300px]">
                        <span className="block truncate font-medium">
                          {r.description}
                        </span>
                        {r.typeLabel && (
                          <span className="text-[11px] text-muted-foreground">
                            {r.typeLabel}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.categoryName ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">{r.dueBR ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge meta={meta} />
                      </TableCell>
                      <TableCell className="text-right stat-number">
                        {formatBRL(r.amount)}
                      </TableCell>
                      {canPay && (
                        <TableCell className="text-right">
                          {meta.label !== "Paga" && <MarkExpensePaid id={r.id} />}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={4}>Total do mês</TableCell>
                  <TableCell className="text-right stat-number">
                    {formatBRL(total)}
                  </TableCell>
                  {canPay && <TableCell />}
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </SectionShell>
  );
}

// ===== Folha do mês =====

export type FolhaRow = {
  employeeId: string;
  name: string;
  role: string | null;
  salary: number;
  commission: number;
  others: number;
  total: number;
};

export function FolhaSection({
  rows,
  total,
  runStatus,
  pctOfRevenue,
  canEdit,
  month,
  year,
}: {
  rows: FolhaRow[];
  total: number;
  runStatus: string | null;
  pctOfRevenue: number;
  canEdit: boolean;
  month: number;
  year: number;
}) {
  const runMeta = runStatus ? payrollStatusMeta(runStatus) : null;
  return (
    <SectionShell
      id="folha"
      title="Folha do Mês"
      subtitle={
        runStatus
          ? `${runMeta?.label} · ${Math.round(pctOfRevenue * 100)}% do faturamento`
          : "Folha ainda não gerada — prévia com salários e comissões do mês"
      }
      action={
        <div className="flex items-center gap-2">
          <Link
            href={`/folha?mes=${year}-${String(month).padStart(2, "0")}`}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            abrir Folha
          </Link>
          {canEdit && (
            <PagarFolhaButton
              month={month}
              year={year}
              runStatus={runStatus}
              total={total}
            />
          )}
        </div>
      }
    >
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Nenhum colaborador ativo com salário definido.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Cargo</TableHead>
                  <TableHead className="text-right">Comissão</TableHead>
                  <TableHead className="text-right">Salário</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">% da folha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.employeeId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.role ?? "—"}
                    </TableCell>
                    <TableCell className="text-right stat-number">
                      {r.commission > 0 ? formatBRL(r.commission) : "—"}
                    </TableCell>
                    <TableCell className="text-right stat-number">
                      {formatBRL(r.salary + r.others)}
                    </TableCell>
                    <TableCell className="text-right stat-number font-medium">
                      {formatBRL(r.total)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {total > 0 ? `${((r.total / total) * 100).toFixed(1).replace(".", ",")}%` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={4}>Total da folha</TableCell>
                  <TableCell className="text-right stat-number">
                    {formatBRL(total)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </SectionShell>
  );
}

// ===== Renovações do mês =====

export type RenovacaoRow = {
  clientId: string;
  name: string;
  status: string;
  modality: string | null;
  expected: number;
  salesOwner: string | null;
  contract: {
    id: string;
    type: string;
    totalValue: number;
    monthlyValue: number;
  } | null;
};

export function RenovacoesSection({
  rows,
  expectedTotal,
  canRenew,
  canMarkLost,
  monthLabel,
}: {
  rows: RenovacaoRow[];
  expectedTotal: number;
  canRenew: boolean;
  canMarkLost: boolean;
  monthLabel: string;
}) {
  return (
    <SectionShell
      id="renovacoes"
      title="Renovações do Mês"
      subtitle={`${rows.length} cliente(s) com renovação em ${monthLabel} · ${formatBRL(expectedTotal)} esperado`}
    >
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              Nenhuma renovação prevista para este mês.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Modalidade</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Valor esperado</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead className="text-right">Renovou?</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.clientId}>
                    <TableCell>
                      <Link
                        href={`/clientes/${r.clientId}`}
                        className="font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.modality ?? "—"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={clientStatusVariant(r.status)}>
                        {(CLIENT_STATUS_LABEL as Record<string, string>)[r.status] ??
                          r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right stat-number">
                      {r.expected > 0 ? formatBRL(r.expected) : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.salesOwner ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {canRenew && r.contract && (
                          <RenewClientDialog
                            contract={r.contract}
                            clientName={r.name}
                            trigger={
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-success border-success/40"
                              >
                                Sim, renovou
                              </Button>
                            }
                          />
                        )}
                        {canRenew && !r.contract && (
                          <span
                            className="text-xs text-muted-foreground"
                            title="Sem acordo comercial cadastrado — renove pela ficha do cliente."
                          >
                            sem acordo
                          </span>
                        )}
                        {canMarkLost && (
                          <ClientLossDialog
                            clientId={r.clientId}
                            clientName={r.name}
                            trigger={
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-destructive border-destructive/40"
                              >
                                Não renovou
                              </Button>
                            }
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </SectionShell>
  );
}
