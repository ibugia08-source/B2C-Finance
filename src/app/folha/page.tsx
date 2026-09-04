import { PageHeader } from "@/components/page-header";
import { SavedViews } from "@/components/saved-views";
import { StatCard } from "@/components/metric-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, formatPercent, parseMonthParam } from "@/lib/format";
import { getPayrollSummary } from "@/lib/services/finance-metrics";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  MobileCards, MobileCard, MobileCardHeader, MobileCardActions, Field,
} from "@/components/ui/record-card";
import { requirePagePermission } from "@/lib/auth/viewer";
import {
  EmployeeDialog, EmployeeActions, GeneratePayrollButton,
  PayrollItemDialog, DeleteItemButton, PayrollStatusButtons,
  CommissionDialog, DeleteCommissionButton, PayComplementButton,
} from "./dialogs";
import { Button } from "@/components/ui/button";
import { Percent } from "lucide-react";
import { EMPLOYEE_TYPE_LABEL, ITEM_KIND_LABEL } from "./_meta";

const RUN_STATUS: Record<string, { label: string; variant: any }> = {
  DRAFT: { label: "Rascunho", variant: "secondary" },
  APPROVED: { label: "Aprovada", variant: "warning" },
  PAID: { label: "Paga", variant: "success" },
};

type Search = { mes?: string };

export default async function FolhaPage({ searchParams }: { searchParams: Search }) {
  await requirePagePermission("folha.visualizar");

  const now = new Date();
  let month = now.getMonth() + 1;
  let year = now.getFullYear();
  const mesParam = parseMonthParam(searchParams.mes);
  if (mesParam) {
    year = mesParam.year;
    month = mesParam.month;
  }

  const [summary, run, employeesRaw, commissionsRaw, clients] = await Promise.all([
    getPayrollSummary(month, year),
    prisma.payroll.findFirst({
      where: { month, year },
      include: {
        items: {
          orderBy: { createdAt: "asc" },
          include: { employee: { select: { name: true } } },
        },
      },
    }),
    prisma.employee.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    prisma.commission.findMany({
      where: { month, year },
      orderBy: { createdAt: "asc" },
      include: {
        employee: { select: { name: true } },
        client: { select: { name: true } },
      },
    }),
    prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const commissions = commissionsRaw.map((c) => ({
    ...c,
    amount: Number(c.amount),
    basisAmount: c.basisAmount != null ? Number(c.basisAmount) : null,
    rate: c.rate != null ? Number(c.rate) : null,
  }));
  const totalComissoes = commissions
    .filter((c) => c.status !== "CANCELED")
    .reduce((s, c) => s + c.amount, 0);
  const comissoesPendentes = commissions.filter((c) => c.status === "PENDING").length;

  const employees = employeesRaw.map((e) => ({
    ...e,
    baseSalary: Number(e.baseSalary),
  }));
  const activeEmployees = employees.filter((e) => e.active);
  const monthValue = `${year}-${String(month).padStart(2, "0")}`;
  const pct = Math.round(summary.folhaSobreReceita * 100);

  return (
    <div>
      <PageHeader
        title="Folha de pagamento"
        description={`Competência ${String(month).padStart(2, "0")}/${year}`}
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <EmployeeDialog />
            <CommissionDialog
              employees={activeEmployees.map((e) => ({ id: e.id, name: e.name }))}
              clients={clients}
              defaultMonth={monthValue}
            />
            <GeneratePayrollButton month={month} year={year} exists={!!run} />
          </div>
        }
      />

      <div className="mb-3 print:hidden">
        <SavedViews module="folha" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
        <StatCard title="Total da folha" value={formatBRL(summary.total)} />
        <StatCard
          title="Comissões do mês"
          value={formatBRL(totalComissoes)}
          intent={comissoesPendentes > 0 ? "warning" : "default"}
          hint={comissoesPendentes > 0 ? `${comissoesPendentes} aguardando “Atualizar folha”` : `${commissions.length} registrada(s)`}
        />
        <StatCard
          title="Folha / receita do mês"
          value={`${pct}%`}
          intent={pct > 40 ? "negative" : pct > 25 ? "warning" : "positive"}
        />
        <StatCard title="Colaboradores ativos" value={String(activeEmployees.length)} />
        <StatCard
          title="Status da folha"
          value={run ? RUN_STATUS[run.status]?.label ?? run.status : "Não gerada"}
        />
      </div>

      {/* Folha do mês */}
      <Card className="mb-3">
        <CardContent className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold">Folha {String(month).padStart(2, "0")}/{year}</h2>
              {run && (
                <Badge variant={RUN_STATUS[run.status]?.variant ?? "secondary"}>
                  {RUN_STATUS[run.status]?.label ?? run.status}
                </Badge>
              )}
              {run?.paidAt && (
                <span className="text-xs text-muted-foreground">
                  paga em {formatDateBR(run.paidAt)}
                </span>
              )}
            </div>
            {run && (
              <div className="flex flex-wrap items-center gap-2">
                <PayrollItemDialog
                  payrollId={run.id}
                  paid={run.status === "PAID"}
                  employees={activeEmployees.map((e) => ({ id: e.id, name: e.name }))}
                />
                {run.status === "PAID" && summary.pendingTotal > 0 && (
                  <PayComplementButton
                    runId={run.id}
                    amount={summary.pendingTotal}
                    competencia={`${String(month).padStart(2, "0")}/${year}`}
                  />
                )}
                <PayrollStatusButtons runId={run.id} status={run.status} />
              </div>
            )}
          </div>

          {!run ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Folha ainda não gerada para esta competência. Clique em{" "}
              <strong>Gerar folha do mês</strong> — os salários dos colaboradores
              ativos entram automaticamente.
            </p>
          ) : run.items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Folha sem itens. Adicione salários, comissões e bônus.
            </p>
          ) : (
            <>
            <MobileCards>
              {run.items.map((item) => {
                const negative = item.kind === "DEDUCTION";
                return (
                  <MobileCard key={item.id}>
                    <MobileCardHeader
                      title={item.employee.name}
                      aside={
                        <span className="flex items-center gap-1">
                          {run.status === "PAID" && !item.settledAt && (
                            <Badge variant="warning">a pagar</Badge>
                          )}
                          <Badge variant={negative ? "destructive" : "outline"}>
                            {ITEM_KIND_LABEL[item.kind] ?? item.kind}
                          </Badge>
                        </span>
                      }
                    />
                    <Field label="Valor">
                      {negative ? "−" : ""}
                      {formatBRL(Number(item.amount))}
                    </Field>
                    {item.notes ? <Field label="Observação">{item.notes}</Field> : null}
                    {run.status !== "PAID" || !item.settledAt ? (
                      <MobileCardActions>
                        <DeleteItemButton id={item.id} />
                      </MobileCardActions>
                    ) : null}
                  </MobileCard>
                );
              })}
              <p className="px-1 text-right text-dense font-semibold">
                Total: {formatBRL(summary.total)}
              </p>
              {run.status === "PAID" && summary.pendingTotal > 0 && (
                <p className="px-1 text-right text-dense font-medium text-warning-foreground">
                  Complemento a pagar: {formatBRL(summary.pendingTotal)}
                </p>
              )}
            </MobileCards>
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Observação</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.items.map((item) => {
                  const negative = item.kind === "DEDUCTION";
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.employee.name}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <Badge variant={negative ? "destructive" : "outline"}>
                            {ITEM_KIND_LABEL[item.kind] ?? item.kind}
                          </Badge>
                          {run.status === "PAID" && !item.settledAt && (
                            <Badge variant="warning">a pagar</Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.notes ?? "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${negative ? "text-red-600" : ""}`}
                      >
                        {negative ? "−" : ""}
                        {formatBRL(Number(item.amount))}
                      </TableCell>
                      <TableCell className="text-right">
                        {(run.status !== "PAID" || !item.settledAt) && (
                          <DeleteItemButton id={item.id} />
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
                <TableRow>
                  <TableCell colSpan={3} className="font-semibold text-right">
                    Total
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {formatBRL(summary.total)}
                  </TableCell>
                  <TableCell />
                </TableRow>
                {run.status === "PAID" && summary.pendingTotal > 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-right font-medium text-warning-foreground">
                      Complemento a pagar (lançamentos pós-pagamento)
                    </TableCell>
                    <TableCell className="text-right font-semibold text-warning-foreground">
                      {formatBRL(summary.pendingTotal)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Comissões da competência */}
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
        Comissões {String(month).padStart(2, "0")}/{year}
      </h2>
      <Card className="mb-3">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Colaborador</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Base × %</TableHead>
                <TableHead>Observação</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commissions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Nenhuma comissão registrada nesta competência. Use{" "}
                    <strong>Nova comissão</strong> (ou o botão % na linha do colaborador).
                  </TableCell>
                </TableRow>
              )}
              {commissions.map((c) => {
                const st =
                  c.status === "PENDING"
                    ? { label: "Aguardando folha", variant: "warning" as const }
                    : c.status === "APPROVED"
                      ? { label: "Na folha", variant: "default" as const }
                      : c.status === "PAID"
                        ? { label: "Paga", variant: "success" as const }
                        : { label: "Cancelada", variant: "secondary" as const };
                return (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.employee.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.client?.name ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {c.basisAmount != null && c.rate != null
                        ? `${formatBRL(c.basisAmount)} × ${formatPercent(c.rate)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{c.notes ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium">{formatBRL(c.amount)}</TableCell>
                    <TableCell>
                      <Badge variant={st.variant as any}>{st.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {c.status === "PENDING" && <DeleteCommissionButton id={c.id} />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Colaboradores */}
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
        Colaboradores
      </h2>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Vínculo</TableHead>
                <TableHead className="text-right">Salário fixo</TableHead>
                <TableHead>Início</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {employees.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    Nenhum colaborador cadastrado.
                  </TableCell>
                </TableRow>
              )}
              {employees.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-medium">{e.name}</TableCell>
                  <TableCell>{e.role ?? "—"}</TableCell>
                  <TableCell>{EMPLOYEE_TYPE_LABEL[e.type] ?? e.type}</TableCell>
                  <TableCell className="text-right">
                    {e.baseSalary > 0 ? formatBRL(e.baseSalary) : "—"}
                  </TableCell>
                  <TableCell>{e.startedAt ? formatDateBR(e.startedAt) : "—"}</TableCell>
                  <TableCell>
                    <Badge variant={e.active ? "success" : "secondary"}>
                      {e.active ? "Ativo" : "Desligado"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end items-center gap-1">
                      {e.active && (
                        <CommissionDialog
                          employees={activeEmployees.map((a) => ({ id: a.id, name: a.name }))}
                          clients={clients}
                          defaultMonth={monthValue}
                          defaultEmployeeId={e.id}
                          trigger={
                            <Button variant="ghost" size="icon" title="Registrar comissão para este colaborador">
                              <Percent className="h-4 w-4 text-primary" />
                            </Button>
                          }
                        />
                      )}
                      <EmployeeActions employee={e} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
