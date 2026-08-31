import { PageHeader } from "@/components/page-header";
import { MetricCard } from "@/components/metric-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatBRL0, formatDateBR, parseMonthParam } from "@/lib/format";
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
import { HandCoins } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { getReceiptsSummary } from "@/lib/services/revenue-metrics";
import { getExpenseSummary } from "@/lib/services/expense-metrics";
import { getPayrollSummary } from "@/lib/services/finance-metrics";
import { BillingDialog } from "./billing-dialog";
import { IncludeClientDialog, type IncludeClientOption } from "./include-client-dialog";
import { CycleFilters } from "./cycle-filters";
import { ClientSearch } from "./search-client";
import { PastDelinquencyDialog } from "./past-delinquency-dialog";
import { ReceivablesTable, type ReceivableRow } from "./receivables-table";
import { GenerateAllButton } from "@/app/acordos/generate-all-button";
import { EXPENSE_TYPE_LABEL } from "@/app/despesas/_meta";
import {
  SectionNav,
  RecebimentosSection,
  ContasSection,
  FolhaSection,
  RenovacoesSection,
  type RecebimentoRow,
  type ContaRow,
  type FolhaRow,
} from "./month-sections";
import { getRenewalPanel } from "@/lib/services/renewal-metrics";
import type { BillingMessageInput } from "@/lib/billing-message";

/**
 * GESTÃO DO MÊS — a "aba mensal" da planilha do dono, numa página só:
 * resumo do mês, clientes do mês (com pagamento em 1 clique), outras
 * entradas, contas a pagar, folha e renovações. Cada seção só aparece
 * (e só consulta o banco) se o usuário tem acesso ao módulo de origem —
 * mesmo padrão da Rotina Diária. Buscas em FASES sequenciais (pool ≈5).
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
  const viewer = await requirePagePermission("recebimentos.visualizar");

  const now = new Date();
  const mes = parseMonthParam(searchParams.mes) ?? {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
  const monthStart = new Date(mes.year, mes.month - 1, 1);
  const monthEnd = new Date(mes.year, mes.month, 1);

  // Gates por módulo de origem (padrão da Rotina): sem permissão, a seção
  // some E as queries dela são puladas.
  const gates = {
    entradas: can(viewer, "receitas.visualizar"),
    entradasCriar: can(viewer, "receitas.editar"),
    contas: can(viewer, "despesas.visualizar"),
    contasCriar: can(viewer, "despesas.editar"),
    contasPagar: can(viewer, "despesas.marcar_como_paga"),
    folha: can(viewer, "folha.visualizar"),
    folhaEditar: can(viewer, "folha.editar"),
    renovacoes: can(viewer, "clientes.visualizar"),
    renovar: can(viewer, "contratos.editar"),
    marcarPerda: can(viewer, "clientes.alterar_status"),
    agendarRenovacao: can(viewer, "clientes.editar"),
    gerarCobrancas: can(viewer, "recebimentos.gerar_cobranca"),
  };

  // Manutenção do ciclo: marca vencidas + gera as mensalidades MRR que faltam.
  await markOverdueBillings();
  await ensureMonthlyBillings(mes.month, mes.year);

  const [billingsRaw, activeClients, allClients, contractsRaw, services, accounts] =
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
        select: {
          id: true, name: true, status: true, modality: true,
          monthlyValue: true, totalContractValue: true, paymentDay: true,
        },
        take: 2000,
      }),
      prisma.contract.findMany({
        orderBy: { title: "asc" },
        select: { id: true, title: true, clientId: true },
        take: 2000,
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

  // ?responsavel= segue aceito na URL (bookmarks), mas sem UI de chips.
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
  // Reconstrução 29/08: os chips carregam o VALOR — substituem o painel de
  // 5 cards que duplicava o resumo do mês com números quase iguais.
  const CHIPS: { label: string; st: string; value?: string }[] = [
    { label: "Todos", st: "" },
    { label: "A vencer", st: "UPCOMING", value: formatBRL0(kAVencer) },
    { label: "Pagos", st: "PAID", value: formatBRL0(kRecebido) },
    { label: "Vencidos", st: "OVERDUE", value: formatBRL0(kVencido) },
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
  const allClientsBasic = allClients.map((c) => ({ id: c.id, name: c.name }));
  // Agendar renovação só faz sentido para cliente em atividade (o painel de
  // renovações filtra por esses status — agendar um CHURNED seria invisível).
  const scheduleClients = allClients
    .filter((c) => ["ACTIVE", "RENEWAL", "DELINQUENT", "PAUSED"].includes(c.status))
    .map((c) => ({ id: c.id, name: c.name }));
  const includeOptions: IncludeClientOption[] = allClients.map((c) => ({
    id: c.id,
    name: c.name,
    modality: c.modality,
    monthlyValue: c.monthlyValue != null ? Number(c.monthlyValue) : null,
    totalContractValue: c.totalContractValue != null ? Number(c.totalContractValue) : null,
    paymentDay: c.paymentDay,
    active: ["ACTIVE", "RENEWAL", "DELINQUENT"].includes(c.status),
  }));
  const tableRows: ReceivableRow[] = visible.map(
    ({ _sort, ...r }) => ({ ...(r as any), _dueDate: undefined, _amount: undefined })
  );

  // ===== FASE B — resumo do mês (fontes oficiais, uma por vez) =====
  const receipts = await getReceiptsSummary(monthStart, monthEnd);
  const expenseSummary = gates.contas ? await getExpenseSummary(monthStart) : null;
  const payrollSummary = gates.folha
    ? await getPayrollSummary(mes.month, mes.year)
    : null;
  const pctRealizacao =
    receipts.expectedTotal > 0 ? receipts.totalRevenue / receipts.expectedTotal : null;
  // PROJEÇÃO do mês (02 §5.2) = FATURAMENTO ESPERADO − despesas (regra da planilha do
  // dono: o resultado projeta o mês cheio, não só o que já caiu na conta).
  const resultadoMes =
    expenseSummary != null ? receipts.expectedTotal - expenseSummary.total : null;

  // ===== FASE C — listas das seções (só as permitidas; ≤4 em paralelo) =====
  const [entradasIncomes, entradasExtras, contasRaw, folhaItems] = await Promise.all([
    gates.entradas
      ? prisma.income.findMany({
          where: {
            receivedAt: { gte: monthStart, lt: monthEnd },
            status: { not: "CANCELED" },
            OR: [{ billingId: null }, { revenueType: "RECOVERY" }],
            // ?cliente= filtra a página inteira — inclusive esta seção.
            ...(searchParams.cliente ? { clientId: searchParams.cliente } : {}),
          },
          orderBy: { receivedAt: "desc" },
          take: 100,
          select: {
            id: true,
            description: true,
            amount: true,
            receivedAt: true,
            status: true,
            revenueType: true,
            client: { select: { name: true } },
            billing: { select: { competenceMonth: true, competenceYear: true } },
          },
        })
      : Promise.resolve([] as any[]),
    gates.entradas
      ? prisma.extraRevenue.findMany({
          where: {
            receivedAt: { gte: monthStart, lt: monthEnd },
            origin: "MANUAL",
            ...(searchParams.cliente ? { clientId: searchParams.cliente } : {}),
          },
          orderBy: { receivedAt: "desc" },
          take: 50,
          select: {
            id: true,
            description: true,
            amount: true,
            receivedAt: true,
            client: { select: { name: true } },
          },
        })
      : Promise.resolve([] as any[]),
    gates.contas
      ? prisma.transaction.findMany({
          where: {
            type: "despesa",
            status: { not: "cancelado" },
            date: { gte: monthStart, lt: monthEnd },
          },
          orderBy: [{ dueDate: "asc" }],
          take: 200,
          select: {
            id: true,
            description: true,
            amount: true,
            dueDate: true,
            status: true,
            expenseType: true,
            category: { select: { name: true } },
          },
        })
      : Promise.resolve([] as any[]),
    // Itens da folha vêm do próprio getPayrollSummary (já buscados no include
    // da FASE B) — sem rebuscar payrollItem na mesma request.
    Promise.resolve(
      gates.folha && payrollSummary?.runId ? payrollSummary.items : ([] as any[])
    ),
  ]);

  // ===== FASE D — apoio (prévia da folha, renovações, categorias) =====
  const [folhaPreviewEmployees, folhaPreviewCommissions, categoriesForQuickAdd] =
    await Promise.all([
      gates.folha && !payrollSummary?.runId
        ? prisma.employee.findMany({
            where: { active: true },
            orderBy: { name: "asc" },
            select: { id: true, name: true, role: true, baseSalary: true },
          })
        : Promise.resolve([] as any[]),
      gates.folha && !payrollSummary?.runId
        ? prisma.commission.findMany({
            where: {
              month: mes.month,
              year: mes.year,
              status: { in: ["PENDING", "APPROVED", "PAID"] },
            },
            select: { employeeId: true, amount: true },
          })
        : Promise.resolve([] as any[]),
      gates.contasCriar
        ? prisma.category.findMany({
            where: { kind: { in: ["despesa", "mista"] } },
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as any[]),
    ]);

  // Renovações do mês — mesma fonte do módulo /renovacoes (painel unificado).
  const renewalPanel = gates.renovacoes
    ? await getRenewalPanel(mes.month, mes.year)
    : null;

  // ===== Montagem dos dados das seções (plain objects) =====
  // RECEBIMENTOS DO MÊS = controle completo das entradas: cobranças de
  // clientes da competência (pagas, a vencer, devendo) + avulsas +
  // recuperações + receitas extras manuais. Reusa as cobranças já buscadas
  // para a lista de clientes (billingRows) — nenhuma query nova.
  type SortableRecebimento = RecebimentoRow & { _sort: number };
  const billingRecebimentos: SortableRecebimento[] = billingRows
    .filter((r) => r.cycleStatus !== "REMOVED")
    .map((r) => {
      const paid = Math.max(0, r.amountDue - r.openAmount);
      const isPaid = ["PAID", "PAID_LATE", "PAID_OTHER_MONTH"].includes(r.cycleStatus);
      const due = (r as any)._dueDate as Date;
      return {
        id: `bil-${r.key}`,
        kind: "billing" as const,
        description: r.description ?? "Mensalidade",
        clientName: r.name,
        amount: r.amountDue,
        paidAmount: paid,
        dateBR: isPaid && r.paidAtBR ? r.paidAtBR : r.dueDateBR ?? "—",
        dateKind: isPaid ? ("pago" as const) : ("vence" as const),
        status: r.cycleStatus,
        isRecovery: false,
        recoveryOf: null,
        _sort: due ? due.getTime() : 0,
      };
    });
  // Recuperação do PRÓPRIO mês exibido sai da lista: o pagamento já está na
  // linha da cobrança (pago com atraso dentro do mês gera Income RECOVERY —
  // exibir os dois contaria o mesmo dinheiro 2x).
  const incomesForSection = entradasIncomes.filter(
    (i: any) =>
      !(
        i.revenueType === "RECOVERY" &&
        i.billing &&
        i.billing.competenceMonth === mes.month &&
        i.billing.competenceYear === mes.year
      )
  );
  const avulsaRecebimentos: SortableRecebimento[] = [
    ...incomesForSection.map((i: any) => ({
      id: `inc-${i.id}`,
      kind: "income" as const,
      description: i.description,
      clientName: i.client?.name ?? null,
      amount: Number(i.amount),
      paidAmount: i.status === "RECEIVED" ? Number(i.amount) : 0,
      dateBR: formatDateBR(i.receivedAt),
      dateKind: "recebido" as const,
      status: i.status,
      isRecovery: i.revenueType === "RECOVERY",
      recoveryOf:
        i.revenueType === "RECOVERY" && i.billing
          ? `${String(i.billing.competenceMonth).padStart(2, "0")}/${i.billing.competenceYear}`
          : null,
      _sort: new Date(i.receivedAt).getTime(),
    })),
    ...entradasExtras.map((e: any) => ({
      id: `ext-${e.id}`,
      kind: "extra" as const,
      description: e.description,
      clientName: e.client?.name ?? null,
      amount: Number(e.amount),
      paidAmount: Number(e.amount),
      dateBR: formatDateBR(e.receivedAt),
      dateKind: "recebido" as const,
      status: "RECEIVED",
      isRecovery: false,
      recoveryOf: null,
      _sort: new Date(e.receivedAt).getTime(),
    })),
  ];
  const recebimentoRows: RecebimentoRow[] = [
    ...billingRecebimentos,
    ...avulsaRecebimentos,
  ]
    .sort((a, b) => a._sort - b._sort)
    .map(({ _sort, ...r }) => r);
  const recebimentosTotals = {
    // PAID_OTHER_MONTH fica FORA do recebido: pela regra de fechamento, o
    // valor conta como recuperação no mês do pagamento, não na competência
    // original (a linha continua visível com o rótulo "Recebido em outro mês").
    recebido:
      billingRecebimentos
        .filter((r) => r.status !== "PAID_OTHER_MONTH")
        .reduce((s, r) => s + r.paidAmount, 0) +
      avulsaRecebimentos
        .filter((r) => r.status === "RECEIVED")
        .reduce((s, r) => s + r.amount, 0),
    aReceber: billingRows
      .filter((r) => r.cycleStatus !== "REMOVED")
      .reduce((s, r) => s + r.openAmount, 0),
    atrasado: billingRows
      .filter((r) => OWING.includes(r.cycleStatus))
      .reduce((s, r) => s + r.openAmount, 0),
  };

  const contaRows: ContaRow[] = contasRaw.map((t: any) => ({
    id: t.id,
    description: t.description,
    categoryName: t.category?.name ?? null,
    typeLabel: t.expenseType ? EXPENSE_TYPE_LABEL[t.expenseType] ?? null : null,
    amount: Number(t.amount),
    dueBR: t.dueDate ? formatDateBR(t.dueDate) : null,
    dueDate: t.dueDate,
    status: t.status,
  }));
  const contasTotal = contaRows.reduce((s, r) => s + r.amount, 0);
  const contasPagas = contasRaw
    .filter((t: any) => t.status === "pago")
    .reduce((s: number, t: any) => s + Number(t.amount), 0);

  let folhaRows: FolhaRow[] = [];
  if (gates.folha && payrollSummary?.runId) {
    const byEmp = new Map<string, FolhaRow>();
    for (const it of folhaItems as any[]) {
      const cur = byEmp.get(it.employeeId) ?? {
        employeeId: it.employeeId,
        name: it.employee?.name ?? "—",
        role: it.employee?.role ?? null,
        salary: 0,
        commission: 0,
        others: 0,
        total: 0,
      };
      const val = Number(it.amount);
      if (it.kind === "SALARY") cur.salary += val;
      else if (it.kind === "COMMISSION") cur.commission += val;
      else if (it.kind === "DEDUCTION") cur.others -= val;
      else cur.others += val;
      cur.total = cur.salary + cur.commission + cur.others;
      byEmp.set(it.employeeId, cur);
    }
    folhaRows = Array.from(byEmp.values()).sort((a, b) => b.total - a.total);
  } else if (gates.folha) {
    const commByEmp = new Map<string, number>();
    for (const c of folhaPreviewCommissions as any[]) {
      commByEmp.set(c.employeeId, (commByEmp.get(c.employeeId) ?? 0) + Number(c.amount));
    }
    folhaRows = (folhaPreviewEmployees as any[])
      .map((e) => {
        const salary = Number(e.baseSalary ?? 0);
        const commission = commByEmp.get(e.id) ?? 0;
        return {
          employeeId: e.id,
          name: e.name,
          role: e.role ?? null,
          salary,
          commission,
          others: 0,
          total: salary + commission,
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total);
  }
  const folhaTotal = payrollSummary?.runId
    ? payrollSummary.total
    : folhaRows.reduce((s, r) => s + r.total, 0);
  const folhaPct = payrollSummary?.runId
    ? payrollSummary.folhaSobreReceita
    : receipts.totalRevenue > 0
      ? folhaTotal / receipts.totalRevenue
      : 0;

  const sectionNavItems = [
    { href: "#clientes", label: "Clientes do mês", count: tableRows.length },
    ...(gates.entradas
      ? [{ href: "#entradas", label: "Recebimentos", count: recebimentoRows.length }]
      : []),
    ...(gates.contas
      ? [{ href: "#contas", label: "Contas a pagar", count: contaRows.length }]
      : []),
    ...(gates.folha
      ? [{ href: "#folha", label: "Folha", count: folhaRows.length }]
      : []),
    ...(gates.renovacoes
      ? [{ href: "#renovacoes", label: "Renovações", count: renewalPanel?.rows.length ?? 0 }]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Gestão do Mês"
        description={`A aba de ${monthLabelStr}: clientes, entradas, contas e folha num lugar só`}
        actions={
          <div className="flex flex-wrap gap-2">
            <PastDelinquencyDialog clients={allClientsBasic} />
            <BillingDialog
              clients={allClientsBasic}
              contracts={contractsRaw}
              services={services}
              defaultCompetence={`${mes.year}-${String(mes.month).padStart(2, "0")}`}
              trigger={
                <Button
                  variant="outline"
                  title="Cobrança avulsa com todos os campos livres (setup, pontual, valor fora do padrão)"
                >
                  Cobrança avulsa
                </Button>
              }
            />
            <IncludeClientDialog
              clients={includeOptions}
              contracts={contractsRaw}
              accounts={accounts}
              month={mes.month}
              year={mes.year}
            />
          </div>
        }
      />

      {/* ===== Barra superior: mês · busca ===== */}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <ClientSearch />
      </div>

      {/* ===== RESUMO DO MÊS — 6 cards (02 §5.2) =====
          O card antes chamado "Resultado do mês" virou "PROJEÇÃO do mês",
          como a spec manda. Não é preciosismo: o número aqui é
          esperado − despesas, e a Início tem um "Resultado do mês" que é
          recebido − despesas. Dois números diferentes com o mesmo rótulo
          em duas telas é exatamente o que §5.5 proíbe. */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Faturamento esperado"
          value={formatBRL(receipts.expectedTotal)}
          basis="competencia"
          hint="tudo que foi cobrado na competência"
          help="Soma de TODA cobrança com competência neste mês que não foi cancelada — mensalidade (MRR), parcela de contrato (TCV), implantação (setup), avulsa e upsell entram todas. Pagas e em aberto contam igual: é o que se esperava faturar, não o que entrou."
        />
        <MetricCard
          title="Recebido no mês"
          value={formatBRL(receipts.totalRevenue)}
          basis="caixa"
          tone="pos"
          hint="mensalidades + entradas"
          help="Dinheiro efetivamente registrado como recebido dentro deste mês, incluindo entradas avulsas."
        />
        <MetricCard
          title="% Realização"
          value={pctRealizacao != null ? `${Math.round(pctRealizacao * 100)}%` : null}
          nullReason="Nada esperado neste mês"
          hint="recebido ÷ esperado"
          help="Quanto do faturamento esperado já virou dinheiro em caixa. Sem cobrança no mês não existe divisão possível, e aí o campo mostra um traço em vez de zero."
          tone={
            pctRealizacao == null
              ? "default"
              : pctRealizacao >= 0.9
                ? "pos"
                : pctRealizacao >= 0.6
                  ? "warn"
                  : "neg"
          }
        />
        <MetricCard
          title="Falta receber"
          value={formatBRL(receipts.openMonth)}
          basis="competencia"
          hint="em aberto na competência"
          help="Faturamento esperado menos o que foi recebido dentro da competência. Não inclui dívida de meses anteriores — essa aparece como recuperação."
          tone={receipts.openMonth > 0 ? "warn" : "pos"}
        />
        {expenseSummary && (
          <MetricCard
            title="Despesas do mês"
            value={formatBRL(expenseSummary.total)}
            basis="competencia"
            tone="neg"
            hint="contas + cartões + folha paga"
            help="Todas as saídas reconhecidas no mês: contas a pagar, faturas de cartão e folha."
          />
        )}
        {resultadoMes != null && (
          <MetricCard
            title="Projeção do mês"
            value={formatBRL(resultadoMes)}
            basis="competencia"
            tone={resultadoMes >= 0 ? "pos" : "neg"}
            hint="esperado − despesas"
            help="Faturamento ESPERADO menos as despesas do mês. É uma projeção: assume que tudo que foi cobrado será recebido. Não confundir com o Resultado do mês da tela Início, que usa o RECEBIDO em caixa e por isso costuma ser menor enquanto o mês não fecha."
          />
        )}
      </div>

      <SectionNav items={sectionNavItems} />

      {/* ================= CLIENTES DO MÊS ================= */}
      <section id="clientes" className="scroll-mt-20">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">
            Clientes do Mês
          </h2>
          <p className="text-xs text-muted-foreground">
            Um cliente por linha, como na planilha — o status colorido registra o
            pagamento de verdade (com Desfazer)
          </p>
        </div>
        <p className="text-sm text-muted-foreground tabular-nums">
          <span className="font-semibold text-foreground">{kPagos}</span>
          {" de "}{chargeRows.length} clientes pagos
        </p>
      </div>

      {/* ===== Chips de status + Mais filtros ===== */}
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        {CHIPS.map((c) => (
          <Link key={c.label} href={chipHref({ st: c.st })}>
            <Badge variant={stFilter === c.st ? "default" : "outline"}>
              {c.label}
              {c.value != null && (
                <span className="ml-1.5 font-normal opacity-75 tabular-nums">{c.value}</span>
              )}
            </Badge>
          </Link>
        ))}
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <CycleFilters clients={allClientsBasic} />
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
      </section>

      {/* ================= RECEBIMENTOS DO MÊS ================= */}
      {gates.entradas && (
        <RecebimentosSection
          rows={recebimentoRows}
          totals={recebimentosTotals}
          canCreate={gates.entradasCriar}
          month={mes.month}
          year={mes.year}
        />
      )}

      {/* ================= CONTAS A PAGAR ================= */}
      {gates.contas && (
        <ContasSection
          rows={contaRows}
          total={contasTotal}
          paidTotal={contasPagas}
          canPay={gates.contasPagar}
          canCreate={gates.contasCriar}
          categories={categoriesForQuickAdd as { id: string; name: string }[]}
          month={mes.month}
          year={mes.year}
        />
      )}

      {/* ================= FOLHA DO MÊS ================= */}
      {gates.folha && (
        <FolhaSection
          rows={folhaRows}
          total={folhaTotal}
          runStatus={payrollSummary?.status ?? null}
          pctOfRevenue={folhaPct}
          canEdit={gates.folhaEditar}
          month={mes.month}
          year={mes.year}
        />
      )}

      {/* ================= RENOVAÇÕES DO MÊS ================= */}
      {gates.renovacoes && renewalPanel && (
        <RenovacoesSection
          rows={renewalPanel.rows}
          expectedTotal={renewalPanel.expectedTotal}
          renewedCount={renewalPanel.renewedCount}
          canRenew={gates.renovar}
          canMarkLost={gates.marcarPerda}
          canSchedule={gates.agendarRenovacao}
          canRegisterPayment={can(viewer, "recebimentos.registrar_pagamento")}
          scheduleClients={scheduleClients}
          monthLabel={referenceMonth}
          competence={`${mes.year}-${String(mes.month).padStart(2, "0")}`}
          defaultMonth={mes.month}
        />
      )}

      {/* ================= Utilitários do mês ================= */}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/60 p-4 print:hidden">
        <p className="text-xs text-muted-foreground max-w-md">
          As mensalidades MRR do mês são geradas automaticamente. Cobranças de
          acordos TCV/contratos podem ser geradas em lote aqui — útil após
          importar contratos.
        </p>
        <div className="flex items-center gap-3">
          <Link
            href="/acordos"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Acordos comerciais
          </Link>
          {gates.gerarCobrancas && <GenerateAllButton />}
        </div>
      </div>
    </div>
  );
}
