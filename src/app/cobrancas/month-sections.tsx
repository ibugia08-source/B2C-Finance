import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  MobileCards, MobileCard, MobileCardHeader, Field,
} from "@/components/ui/record-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBRL, formatPercent } from "@/lib/format";
import {
  incomeStatusMeta,
  cycleStatusMeta,
  expenseStatusMeta,
  payrollStatusMeta,
  type StatusMeta,
} from "@/lib/status-meta";
import { MarkExpensePaid } from "@/app/rotina/expense-actions";
import { RenewalsTable } from "@/app/renovacoes/renewals-table";
import { ScheduleRenewalDialog } from "@/app/renovacoes/schedule-renewal-dialog";
import type { RenewalPanelRow } from "@/lib/services/renewal-metrics";
import {
  EntradaQuickDialog,
  ContaQuickDialog,
  PagarFolhaButton,
} from "./quick-dialogs";

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

// ===== Recebimentos do Mês =====

/**
 * Uma linha do controle de recebimentos: cobrança de cliente (paga, a vencer
 * ou devendo), entrada avulsa, recuperação de inadimplência ou receita extra
 * manual — TODAS as entradas do mês num lugar só, como a coluna de entradas
 * da planilha.
 */
export type RecebimentoRow = {
  id: string;
  kind: "billing" | "income" | "extra";
  description: string;
  clientName: string | null;
  amount: number;
  /** parte já paga (cobranças parciais mostram "pago X de Y") */
  paidAmount: number;
  dateBR: string;
  /** rótulo curto da data: "pago em" | "vence" | "recebido em" */
  dateKind: "pago" | "vence" | "recebido";
  /** CycleStatus (billing) ou Income.status — resolvido pelo kind */
  status: string;
  isRecovery: boolean;
  recoveryOf: string | null; // "MM/AAAA" da competência recuperada
};

export type RecebimentosTotals = {
  recebido: number;
  aReceber: number;
  atrasado: number;
};

function recebimentoMeta(r: RecebimentoRow): StatusMeta {
  return r.kind === "billing" ? cycleStatusMeta(r.status) : incomeStatusMeta(r.status);
}

const KIND_LABEL: Record<RecebimentoRow["kind"], string | null> = {
  billing: null, // mensalidade/cobrança — o cliente já identifica
  income: "avulsa",
  extra: "receita extra",
};

export function RecebimentosSection({
  rows,
  totals,
  canCreate,
  month,
  year,
}: {
  rows: RecebimentoRow[];
  totals: RecebimentosTotals;
  canCreate: boolean;
  month: number;
  year: number;
}) {
  return (
    <SectionShell
      id="entradas"
      title="Recebimentos do Mês"
      subtitle="Todas as entradas do mês — pagas, a vencer e atrasadas: mensalidades, avulsas, recuperações e receitas extras"
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
              Nenhum recebimento neste mês.
            </p>
          ) : (
            <Table containerClassName="max-h-[56vh]">
              <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const meta = recebimentoMeta(r);
                  const kindLabel = KIND_LABEL[r.kind];
                  return (
                    <TableRow key={r.id} className={meta.rowClass}>
                      <TableCell className="max-w-[340px]">
                        <span className="block truncate font-medium">
                          {r.clientName ?? r.description}
                        </span>
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {r.clientName && (
                            <span className="truncate">{r.description}</span>
                          )}
                          {kindLabel && (
                            <Badge variant="outline" className="text-[10px]">
                              {kindLabel}
                            </Badge>
                          )}
                          {r.isRecovery && (
                            <Badge variant="outline" className="text-[10px]">
                              recuperação{r.recoveryOf ? ` de ${r.recoveryOf}` : ""}
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {r.dateBR}
                        <span className="block text-[10px] text-muted-foreground">
                          {r.dateKind === "pago"
                            ? "pago em"
                            : r.dateKind === "vence"
                              ? "vencimento"
                              : "recebido em"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge meta={meta} />
                      </TableCell>
                      <TableCell className="text-right stat-number">
                        {formatBRL(r.amount)}
                        {r.paidAmount > 0 && r.paidAmount < r.amount && (
                          <span className="block text-[10px] text-muted-foreground">
                            pago {formatBRL(r.paidAmount)}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={3}>Recebido no mês</TableCell>
                  <TableCell className="text-right stat-number text-success">
                    {formatBRL(totals.recebido)}
                  </TableCell>
                </TableRow>
                <TableRow className="bg-muted/20 text-sm">
                  <TableCell colSpan={3}>A receber (a vencer + atrasado)</TableCell>
                  <TableCell className="text-right stat-number">
                    {formatBRL(totals.aReceber)}
                  </TableCell>
                </TableRow>
                {totals.atrasado > 0 && (
                  <TableRow className="bg-muted/20 text-sm">
                    <TableCell colSpan={3} className="text-destructive">
                      Atrasado (dentro do a receber)
                    </TableCell>
                    <TableCell className="text-right stat-number text-destructive">
                      {formatBRL(totals.atrasado)}
                    </TableCell>
                  </TableRow>
                )}
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
            abrir Contas a Pagar
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
            <>
            <MobileCards>
              {rows.map((r) => (
                <MobileCard key={r.employeeId}>
                  <MobileCardHeader title={r.name} aside={null} />
                  {r.role ? <Field label="Cargo">{r.role}</Field> : null}
                  <Field label="Salário">{formatBRL(r.salary + r.others)}</Field>
                  {r.commission > 0 ? (
                    <Field label="Comissão">{formatBRL(r.commission)}</Field>
                  ) : null}
                  <Field label="Total">{formatBRL(r.total)}</Field>
                </MobileCard>
              ))}
            </MobileCards>
            <div className="hidden md:block">
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
                      {total > 0 ? formatPercent(r.total / total) : "—"}
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
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </SectionShell>
  );
}

// ===== Renovações do mês =====

export function RenovacoesSection({
  rows,
  expectedTotal,
  renewedCount,
  canRenew,
  canMarkLost,
  canSchedule,
  canRegisterPayment,
  scheduleClients,
  monthLabel,
  competence,
  defaultMonth,
}: {
  rows: RenewalPanelRow[];
  expectedTotal: number;
  renewedCount: number;
  canRenew: boolean;
  canMarkLost: boolean;
  canSchedule: boolean;
  canRegisterPayment: boolean;
  scheduleClients: { id: string; name: string }[];
  monthLabel: string;
  competence: string; // "YYYY-MM"
  defaultMonth: number;
}) {
  return (
    <SectionShell
      id="renovacoes"
      title="Renovações do Mês"
      subtitle={`${rows.length} cliente(s) com renovação em ${monthLabel} · ${formatBRL(expectedTotal)} esperado · ${renewedCount} renovado(s)`}
      action={
        <div className="flex items-center gap-2">
          <Link
            href={`/renovacoes?mes=${competence}`}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            abrir Renovações
          </Link>
          {canSchedule && (
            <ScheduleRenewalDialog clients={scheduleClients} defaultMonth={defaultMonth} />
          )}
        </div>
      }
    >
      <Card>
        <CardContent className="p-0">
          <RenewalsTable
            rows={rows}
            canRenew={canRenew}
            canMarkLost={canMarkLost}
            canRegisterPayment={canRegisterPayment}
            defaultCompetence={competence}
            emptyMessage="Nenhuma renovação prevista para este mês. Use Agendar renovação para incluir um cliente."
          />
        </CardContent>
      </Card>
    </SectionShell>
  );
}
