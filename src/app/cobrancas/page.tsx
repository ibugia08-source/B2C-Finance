import { PageHeader } from "@/components/page-header";
import { CobrancasTabs } from "@/app/cobrancas/module-tabs";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, parseMonthParam } from "@/lib/format";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";
import {
  ensureMonthlyBillings,
  cycleStatusOf,
  CYCLE_STATUS_LABEL,
  type CycleStatus,
} from "@/lib/services/receivables-cycle";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus, HandCoins } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { requirePagePermission } from "@/lib/auth/viewer";
import { BillingDialog } from "./billing-dialog";
import { MonthNav } from "./month-nav";
import { CycleFilters } from "./cycle-filters";
import { ClientSearch } from "./search-client";
import { PastDelinquencyDialog } from "./past-delinquency-dialog";
import { ReceivablesTable, type ReceivableRow } from "./receivables-table";
import type { BillingMessageInput } from "@/lib/billing-message";

/**
 * RECEBIMENTOS — lista mensal simples dos clientes ativos e o status de
 * pagamento de cada um no mês selecionado. Edição rápida inline (sincroniza
 * com a Gestão de Carteira), registro de pagamento, texto de cobrança e
 * ajuste pontual da data do mês. Cadastro de cliente é SÓ na Carteira.
 */

type Search = {
  mes?: string; // YYYY-MM
  st?: string; // CycleStatus
  responsavel?: string;
  cliente?: string;
  q?: string; // busca por nome do cliente
  // "Mais filtros"
  mod?: string; // MRR | TCV
  vmin?: string;
  vmax?: string;
  vde?: string; // vencimento a partir de (YYYY-MM-DD)
  vate?: string; // vencimento até (YYYY-MM-DD)
  // compat com links antigos (dashboard/rotina)
  situacao?: string; // atrasado | outro-mes
  avencer?: string;
  status?: string; // OVERDUE | PAID (legado)
};

/** "1.500,00" | "1500.00" → número (filtros de valor). */
function parseMoneyParam(v?: string): number | null {
  if (!v) return null;
  const num = Number(v.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function parseISODateParam(v?: string): Date | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Mapeia parâmetros legados para o filtro do ciclo. */
function legacyStatus(sp: Search): string {
  if (sp.st) return sp.st;
  if (sp.situacao === "atrasado") return "PAID_LATE";
  if (sp.situacao === "outro-mes") return "PAID_OTHER_MONTH";
  if (sp.avencer === "1") return "UPCOMING";
  if (sp.status === "OVERDUE") return "OVERDUE";
  if (sp.status === "PAID") return "PAID";
  return "";
}

/** Status "devendo" (vencido automático ou inadimplente manual). */
const OWING: string[] = ["OVERDUE", "DELINQUENT"];

export default async function RecebimentosPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  await requirePagePermission("recebimentos.visualizar");

  const now = new Date();
  const mes = parseMonthParam(searchParams.mes) ?? {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };

  // Manutenção do ciclo: marca vencidas + gera as mensalidades MRR que faltam.
  await markOverdueBillings();
  await ensureMonthlyBillings(mes.month, mes.year);

  const [billingsRaw, activeClients, allClients, contractsRaw, services, accounts, respRows] =
    await Promise.all([
      prisma.billing.findMany({
        where: {
          competenceMonth: mes.month,
          competenceYear: mes.year,
          ...(searchParams.cliente ? { clientId: searchParams.cliente } : {}),
        },
        orderBy: [{ dueDate: "asc" }],
        take: 500,
        include: {
          client: {
            select: {
              id: true, name: true, phone: true, modality: true,
              paymentDay: true, salesOwner: true, contractMonths: true, status: true,
            },
          },
          contract: { select: { title: true } },
          service: { select: { name: true } },
          _count: { select: { history: true } },
        },
      }),
      // Clientes ativos da carteira — aparecem mesmo sem cobrança no mês.
      prisma.client.findMany({
        where: { status: { in: ["ACTIVE", "RENEWAL", "DELINQUENT"] } },
        select: {
          id: true, name: true, phone: true, modality: true, paymentDay: true,
          salesOwner: true, contractMonths: true, monthlyValue: true,
        },
        orderBy: { name: "asc" },
        take: 1000,
      }),
      prisma.client.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
        take: 2000,
      }),
      prisma.contract.findMany({
        orderBy: { title: "asc" },
        select: { id: true, title: true, clientId: true },
      }),
      prisma.service.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.account.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.client.findMany({
        where: { salesOwner: { not: null } },
        distinct: ["salesOwner"],
        select: { salesOwner: true },
        orderBy: { salesOwner: "asc" },
      }),
    ]);

  const today = new Date();
  const monthLabelStr = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(mes.year, mes.month - 1, 1));
  const referenceMonth =
    monthLabelStr.charAt(0).toUpperCase() + monthLabelStr.slice(1).replace(" de ", "/");

  // ===== Linhas: cobranças do mês + clientes ativos sem cobrança =====
  type Row = ReceivableRow & { _sort: string };

  const msgOf = (
    name: string,
    open: number,
    due: Date | null,
    daysLate: number,
    contacts: number,
    hasPromise: boolean
  ): BillingMessageInput => ({
    clientName: name,
    openAmount: formatBRL(open),
    dueDate: due ? formatDateBR(due) : "—",
    daysOverdue: daysLate,
    serviceNames: [],
    hasPromise,
    contactCount: contacts,
    referenceMonth,
  });

  const billingRows: Row[] = billingsRaw.map((b) => {
    const amount = Number(b.amount);
    const paidTotal = Number(b.paidTotal);
    const openAmount = Math.max(0, amount - paidTotal);
    const { status, daysLate } = cycleStatusOf(
      {
        id: b.id, status: b.status, isLate: b.isLate,
        paidInDifferentMonth: b.paidInDifferentMonth,
        dueDate: b.dueDate, paidAt: b.paidAt,
        collectionStatus: b.collectionStatus,
      },
      today
    );
    return {
      key: b.id,
      clientId: b.client.id,
      billingId: b.id,
      name: b.client.name,
      phone: b.client.phone,
      modality: b.client.modality,
      paymentDay: b.client.paymentDay,
      contractMonths: b.client.contractMonths,
      amountDue: amount,
      openAmount,
      description: b.description,
      cycleStatus: status,
      statusLabel: CYCLE_STATUS_LABEL[status],
      daysLate,
      paidAtBR: b.paidAt ? formatDateBR(b.paidAt) : null,
      dueDateBR: formatDateBR(b.dueDate),
      responsible: b.collector ?? b.client.salesOwner ?? null,
      removedInfo:
        status === "REMOVED"
          ? `Removido${b.canceledAt ? ` em ${formatDateBR(b.canceledAt)}` : ""}${b.canceledBy ? ` por ${b.canceledBy}` : ""}${b.cancelReason ? ` — ${b.cancelReason}` : ""}. Continua na Gestão de Carteira.`
          : null,
      msg: msgOf(
        b.client.name,
        openAmount > 0 ? openAmount : amount,
        b.dueDate,
        OWING.includes(status) ? daysLate : 0,
        b._count.history,
        b.collectionStatus === "PROMISED"
      ),
      _sort: b.client.name,
      _dueDate: b.dueDate,
      _amount: amount,
    } as Row & { _dueDate: Date; _amount: number };
  });

  const withBilling = new Set(
    billingsRaw.filter((b) => b.status !== "CANCELED").map((b) => b.clientId)
  );
  const removedClientIds = new Set(
    billingsRaw.filter((b) => b.status === "CANCELED").map((b) => b.clientId)
  );
  // Só clientes MRR entram automaticamente sem cobrança (mostram a mensalidade
  // prevista). TCV NUNCA entra fora do mês de adesão/renovação (Bloco 2 §12) —
  // aparece apenas quando tem cobrança TCV na competência (billingRows).
  const noChargeRows: Row[] = activeClients
    .filter((c) => c.modality === "MRR")
    .filter((c) => !withBilling.has(c.id) && !removedClientIds.has(c.id))
    .filter((c) => (searchParams.cliente ? c.id === searchParams.cliente : true))
    .map((c) => {
      // Vencimento MRR calculado pelo dia recorrente (clamp fim de mês, §15).
      const due = getValidDueDateForMonth(mes.year, mes.month, c.paymentDay);
      return {
        key: c.id,
        clientId: c.id,
        billingId: null,
        name: c.name,
        phone: c.phone,
        modality: c.modality,
        paymentDay: c.paymentDay,
        contractMonths: c.contractMonths,
        amountDue: Number(c.monthlyValue ?? 0),
        openAmount: 0,
        description: null,
        cycleStatus: "NO_CHARGE",
        statusLabel: "Sem cobrança no mês",
        daysLate: 0,
        paidAtBR: null,
        dueDateBR: formatDateBR(due),
        responsible: c.salesOwner ?? null,
        removedInfo: null,
        msg: msgOf(c.name, Number(c.monthlyValue ?? 0), due, 0, 0, false),
        _sort: c.name,
        _dueDate: due,
      } as Row & { _dueDate: Date };
    });

  const stFilter = legacyStatus(searchParams);
  const respFilter = searchParams.responsavel ?? "";
  const vmin = parseMoneyParam(searchParams.vmin);
  const vmax = parseMoneyParam(searchParams.vmax);
  const vde = parseISODateParam(searchParams.vde);
  const vate = parseISODateParam(searchParams.vate);
  const modFilter =
    searchParams.mod === "MRR" || searchParams.mod === "TCV" ? searchParams.mod : "";
  const q = (searchParams.q ?? "").trim().toLowerCase();

  const allRows: Row[] = [...billingRows, ...noChargeRows].sort((a, b) =>
    a._sort.localeCompare(b._sort, "pt-BR")
  );

  // Removidos ficam ocultos, a menos que o filtro peça.
  const baseRows = allRows.filter((r) =>
    stFilter === "REMOVED" ? r.cycleStatus === "REMOVED" : r.cycleStatus !== "REMOVED"
  );

  // ===== Painel do mês (5 métricas, sobre as cobranças do ciclo) =====
  const chargeRows = baseRows.filter((r) => r.billingId && r.cycleStatus !== "REMOVED");
  const paidOf = (r: Row) => r.amountDue - r.openAmount;
  // A receber = o que ainda não foi pago no mês (a vencer + vencido).
  const kAReceber = chargeRows.reduce((s, r) => s + r.openAmount, 0);
  const kRecebido = chargeRows.reduce((s, r) => s + paidOf(r), 0);
  const kAVencer = chargeRows
    .filter((r) => r.cycleStatus === "UPCOMING" || r.cycleStatus === "PARTIAL")
    .reduce((s, r) => s + r.openAmount, 0);
  const kVencido = chargeRows
    .filter((r) => OWING.includes(r.cycleStatus))
    .reduce((s, r) => s + r.openAmount, 0);
  const kPagos = chargeRows.filter((r) =>
    ["PAID", "PAID_LATE"].includes(r.cycleStatus)
  ).length;

  // ===== Filtros de visualização =====
  // "Pagos" agrupa todas as variações de pagamento concluído.
  const PAID_GROUP = ["PAID", "PAID_LATE", "PAID_OTHER_MONTH"];
  const visible = baseRows.filter((r) => {
    if (stFilter === "PAID") {
      if (!PAID_GROUP.includes(r.cycleStatus)) return false;
    } else if (stFilter && stFilter !== "REMOVED" && r.cycleStatus !== stFilter) {
      return false;
    }
    if (respFilter && r.responsible !== respFilter) return false;
    if (modFilter && (r.modality ?? "") !== modFilter) return false;
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (vmin != null && r.amountDue < vmin) return false;
    if (vmax != null && r.amountDue > vmax) return false;
    const due = (r as any)._dueDate as Date | undefined;
    if (vde && (!due || due < vde)) return false;
    if (vate) {
      const cap = new Date(vate);
      cap.setHours(23, 59, 59, 999);
      if (!due || due > cap) return false;
    }
    return true;
  });

  const responsibles = respRows.map((r) => r.salesOwner!).filter(Boolean);

  const chipHref = (params: Record<string, string>) => {
    const spNew = new URLSearchParams();
    if (searchParams.mes) spNew.set("mes", searchParams.mes);
    if (searchParams.responsavel) spNew.set("responsavel", searchParams.responsavel);
    if (searchParams.q) spNew.set("q", searchParams.q);
    for (const k of ["mod", "cliente", "vmin", "vmax", "vde", "vate"] as const) {
      if (searchParams[k]) spNew.set(k, searchParams[k]!);
    }
    for (const [k, v] of Object.entries(params)) if (v) spNew.set(k, v);
    const qs = spNew.toString();
    return qs ? `/cobrancas?${qs}` : "/cobrancas";
  };

  // Filtros enxutos: variações de "pago" (com atraso / outro mês) continuam
  // visíveis no status de cada linha e acessíveis por link direto (?st=).
  const CHIPS: { label: string; st: string }[] = [
    { label: "Todos", st: "" },
    { label: "A vencer", st: "UPCOMING" },
    { label: "Pagos", st: "PAID" },
    { label: "Vencidos", st: "OVERDUE" },
    { label: "Inadimplentes", st: "DELINQUENT" },
    { label: "Sem cobrança", st: "NO_CHARGE" },
    { label: "Removidos do mês", st: "REMOVED" },
  ];

  // Estado vazio contextual.
  const emptyMessage: string = q
    ? `Nenhum cliente com "${searchParams.q}" no ciclo deste mês.`
    : stFilter === "OVERDUE" || stFilter === "DELINQUENT"
      ? "Nenhum cliente inadimplente neste mês. Todos os recebimentos estão em dia até o momento."
      : stFilter === "PAID_LATE"
        ? "Nenhum pagamento atrasado encontrado no período selecionado."
        : stFilter === "REMOVED"
          ? "Nenhum cliente removido do ciclo deste mês. Clientes removidos continuam cadastrados normalmente na Gestão de Carteira."
          : stFilter === "PAID"
            ? "Nenhum pagamento registrado neste mês até o momento."
            : stFilter === "PAID_OTHER_MONTH"
              ? "Nenhum recebimento deste mês foi regularizado em outro mês."
              : stFilter === "UPCOMING"
                ? "Nenhuma cobrança a vencer neste mês."
                : "Nenhum cliente encontrado no ciclo de recebimentos deste mês. Você pode adicionar clientes manualmente ou revisar a Gestão de Carteira.";

  // Serializa para o client component (sem Date/Decimal).
  const tableRows: ReceivableRow[] = visible.map(
    ({ _sort, ...r }) => ({ ...(r as any), _dueDate: undefined, _amount: undefined })
  );

  return (
    <div>
      <PageHeader
        title="Recebimentos"
        description={`Gerencie o ciclo mensal de pagamentos dos clientes · ${monthLabelStr}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <PastDelinquencyDialog clients={allClients} />
            <BillingDialog
              clients={allClients}
              contracts={contractsRaw}
              services={services}
              defaultCompetence={`${mes.year}-${String(mes.month).padStart(2, "0")}`}
              trigger={
                <Button title="Adiciona um cliente já cadastrado à lista deste mês (valor, vencimento, modalidade e observação)">
                  <Plus className="h-4 w-4 mr-1" /> Incluir cliente no mês
                </Button>
              }
            />
          </div>
        }
      />

      <CobrancasTabs active="/cobrancas" />

      {/* ===== Barra superior: mês · busca · responsável ===== */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <MonthNav month={mes.month} year={mes.year} />
          <ClientSearch />
        </div>
        {responsibles.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Responsável:</span>
            <Link href={chipHref({ st: stFilter })}>
              <Badge variant={!respFilter ? "default" : "outline"}>Todos</Badge>
            </Link>
            {responsibles.map((r) => (
              <Link
                key={r}
                href={chipHref({ st: stFilter, responsavel: respFilter === r ? "" : r })}
              >
                <Badge variant={respFilter === r ? "default" : "outline"}>{r}</Badge>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* ===== Painel do mês: só as 5 métricas essenciais (clicáveis) ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
        <StatCard title="A receber" value={formatBRL(kAReceber)}
          hint="ainda não pago no mês" href={chipHref({})} />
        <StatCard title="Recebido" value={formatBRL(kRecebido)} intent="positive"
          href={chipHref({ st: "PAID" })} />
        <StatCard title="A vencer" value={formatBRL(kAVencer)} intent="warning"
          href={chipHref({ st: "UPCOMING" })} />
        <StatCard title="Vencido" value={formatBRL(kVencido)}
          intent={kVencido > 0 ? "negative" : "default"}
          href={chipHref({ st: "OVERDUE" })} />
        <StatCard title="Clientes pagos" value={String(kPagos)} intent="positive"
          href={chipHref({ st: "PAID" })} />
      </div>

      {/* ===== Chips de status + Mais filtros ===== */}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        {CHIPS.map((c) => (
          <Link key={c.label} href={chipHref({ st: c.st })}>
            <Badge variant={stFilter === c.st ? "default" : "outline"}>{c.label}</Badge>
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <CycleFilters clients={allClients} />
        <Link
          href="/relatorios/recebimentos"
          className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Exportar (relatório de recebimentos)
        </Link>
      </div>

      {stFilter === "REMOVED" && tableRows.length > 0 && (
        <p className="mb-3 text-xs text-muted-foreground">
          Estes clientes foram removidos do ciclo de recebimentos deste mês.
          Eles continuam cadastrados normalmente na Gestão de Carteira — use a
          ação de recolocar para devolvê-los ao mês.
        </p>
      )}

      <Card>
        <CardContent className="p-0">
          {tableRows.length === 0 ? (
            <EmptyState
              icon={HandCoins}
              title="Nada por aqui neste mês"
              description={emptyMessage}
              action={
                !stFilter && !q ? (
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/clientes">Abrir Clientes</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ReceivablesTable
              rows={tableRows}
              accounts={accounts}
              month={mes.month}
              year={mes.year}
            />
          )}
        </CardContent>
      </Card>

      <p className="mt-3 text-xs text-muted-foreground print:hidden">
        Clientes MRR ativos entram automaticamente no ciclo do mês; TCV entra
        apenas no mês de adesão/renovação, sem rateio. Alterações de modalidade,
        vencimento, valor e prazo feitas aqui atualizam também o cadastro.
        Removidos do mês não são recriados e o cliente nunca é apagado. Para
        cadastrar um novo cliente, acesse a{" "}
        <Link href="/clientes" className="underline">Gestão de Carteira</Link>.
      </p>
    </div>
  );
}
