import { PageHeader } from "@/components/page-header";
import { SavedViews } from "@/components/saved-views";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, monthRange } from "@/lib/format";
import {
  getMonthDelinquencies,
  type MonthDelinquency,
} from "@/lib/services/client-metrics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/viewer";
import { ClientDialog } from "./client-dialog";
import { ContractUploadDialog } from "./contract-upload-dialog";
import { ClientFilters } from "./filters";
import { ClientsTable, type ClientRow } from "./clients-table";
import { CobrancasTabs } from "@/app/cobrancas/module-tabs";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";
import type { DelinquencyValue } from "./_meta";

const PAGE_SIZE = 50;

type Search = {
  q?: string;
  status?: string;
  modalidade?: string; // MRR | TCV
  inadimplencia?: string; // pago | devendo
  mesRenovacao?: string; // 1-12
  servico?: string;
  segmento?: string;
  responsavel?: string;
  ordem?: string; // az | za
  pagina?: string;
};

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  await requireAdmin();

  // ---------- where (filtros que rodam no banco) ----------
  const where: any = {};
  if (searchParams.status) where.status = searchParams.status;
  if (searchParams.segmento) where.segment = searchParams.segmento;
  if (searchParams.modalidade) where.modality = searchParams.modalidade;
  if (searchParams.responsavel) where.salesOwner = searchParams.responsavel;
  if (searchParams.mesRenovacao) {
    const mr = parseInt(searchParams.mesRenovacao, 10);
    if (mr >= 1 && mr <= 12) where.renewalMonth = mr;
  }
  if (searchParams.q) {
    const q = searchParams.q.trim();
    const like = { contains: q, mode: "insensitive" as const };
    where.AND = [
      ...(where.AND ?? []),
      {
        OR: [
          { name: like },
          { legalName: like },
          { document: like },
          { email: like },
          { segment: like },
          { city: like },
          { salesOwner: like },
          { opsOwner: like },
          { tags: { has: q.toLowerCase() } },
        ],
      },
    ];
  }
  if (searchParams.servico) {
    where.contracts = {
      some: {
        status: "ACTIVE",
        services: { some: { serviceId: searchParams.servico } },
      },
    };
  }

  const page = Math.max(1, parseInt(searchParams.pagina ?? "1", 10) || 1);
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const { start, end } = monthRange();

  // ---------- índice leve de TODOS os clientes do filtro (ordenado) ----------
  // Usado para: (1) inadimplência do mês por cliente, (2) filtro Pago/Devendo,
  // (3) seleção "todos os filtrados". Campos mínimos → barato mesmo com muitos.
  const [index, services, segmentRows, ownerRows, ativos, novosMes, mrrAgg] =
    await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { name: searchParams.ordem === "za" ? "desc" : "asc" },
        select: {
          id: true,
          delinquencyOverride: true,
          delinquencyOverrideMonth: true,
          delinquencyOverrideYear: true,
          delinquencyOverrideBy: true,
        },
      }),
      prisma.service.findMany({
        where: { active: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      prisma.client.findMany({
        where: { segment: { not: null } },
        distinct: ["segment"],
        select: { segment: true },
        orderBy: { segment: "asc" },
      }),
      prisma.client.findMany({
        where: { salesOwner: { not: null } },
        distinct: ["salesOwner"],
        select: { salesOwner: true },
        orderBy: { salesOwner: "asc" },
      }),
      prisma.client.count({ where: { status: "ACTIVE" } }),
      prisma.client.count({ where: { startedAt: { gte: start, lt: end } } }),
      // MRR base = Σ mensalidade dos clientes ATIVOS na modalidade MRR.
      // TCV usa totalContractValue (não mensalidade) e não entra aqui, mesmo
      // que tenha um monthlyValue legado/residual gravado.
      prisma.client.aggregate({
        where: { status: "ACTIVE", modality: "MRR" },
        _sum: { monthlyValue: true },
      }),
    ]);

  const autoDelinq = await getMonthDelinquencies(
    index.map((c) => c.id),
    curMonth,
    curYear
  );

  // Inadimplência EFETIVA: override manual da competência corrente vence o auto.
  type IndexRow = (typeof index)[number];
  function effectiveDelinquency(c: IndexRow): {
    value: DelinquencyValue | "SEM_COBRANCA";
    manual: boolean;
    by: string | null;
  } {
    const overrideActive =
      c.delinquencyOverride != null &&
      c.delinquencyOverrideMonth === curMonth &&
      c.delinquencyOverrideYear === curYear;
    if (overrideActive) {
      return {
        value: c.delinquencyOverride as DelinquencyValue,
        manual: true,
        by: c.delinquencyOverrideBy ?? null,
      };
    }
    return {
      value: (autoDelinq.get(c.id) ?? "SEM_COBRANCA") as MonthDelinquency,
      manual: false,
      by: null,
    };
  }

  // Filtro Pago/Devendo (em memória, pois depende do override + competência).
  let filtered = index;
  if (searchParams.inadimplencia === "pago" || searchParams.inadimplencia === "devendo") {
    const want = searchParams.inadimplencia.toUpperCase();
    filtered = index.filter((c) => effectiveDelinquency(c).value === want);
  }

  const allFilteredIds = filtered.map((c) => c.id);
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageSlice = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const indexById = new Map(index.map((c) => [c.id, c]));

  // ---------- linhas completas só da página (ordem preservada) ----------
  const pageIds = pageSlice.map((c) => c.id);
  const rowsRaw = await prisma.client.findMany({
    where: { id: { in: pageIds } },
    select: {
      id: true,
      name: true,
      segment: true,
      status: true,
      modality: true,
      salesOwner: true,
      renewalMonth: true,
      monthlyValue: true,
      totalContractValue: true,
      paymentDay: true,
      contractMonths: true,
      startedAt: true,
    },
  });
  const rowById = new Map(rowsRaw.map((r) => [r.id, r]));
  const clients: ClientRow[] = pageIds
    .map((id) => rowById.get(id))
    .filter((r): r is (typeof rowsRaw)[number] => r != null)
    .map((r) => {
      // Valor de referência da linha: MRR usa mensal; TCV usa total do contrato.
      const monthly = r.monthlyValue != null ? Number(r.monthlyValue) : null;
      const total = r.totalContractValue != null ? Number(r.totalContractValue) : null;
      const refValue = r.modality === "TCV" ? total : monthly;
      // Vencimento do mês corrente (MRR) — dia recorrente clampado ao mês.
      const dueThisMonth =
        r.modality === "MRR" && r.paymentDay != null
          ? getValidDueDateForMonth(curYear, curMonth, r.paymentDay)
          : null;
      // Meses ativo na base (a partir da entrada).
      const monthsActive = r.startedAt
        ? Math.max(
            0,
            (curYear - r.startedAt.getFullYear()) * 12 +
              (curMonth - 1 - r.startedAt.getMonth())
          )
        : null;
      return {
        id: r.id,
        name: r.name,
        segment: r.segment,
        status: r.status,
        modality: r.modality,
        salesOwner: r.salesOwner,
        renewalMonth: r.renewalMonth,
        monthlyValue: monthly,
        totalContractValue: total,
        refValue: refValue != null ? refValue : null,
        paymentDay: r.paymentDay,
        contractMonths: r.contractMonths,
        dueDay: dueThisMonth ? dueThisMonth.getDate() : null,
        monthsActive,
        delinquency: effectiveDelinquency(indexById.get(r.id)!),
      };
    });

  const segments = segmentRows.map((r) => r.segment!).filter(Boolean);
  const owners = ownerRows.map((r) => r.salesOwner!).filter(Boolean);
  const mrrBase = mrrAgg._sum.monthlyValue != null ? Number(mrrAgg._sum.monthlyValue) : 0;
  const devendoMes = index.filter((c) => effectiveDelinquency(c).value === "DEVENDO").length;

  function pageHref(p: number) {
    const params = new URLSearchParams(searchParams as Record<string, string>);
    params.set("pagina", String(p));
    return `/clientes?${params.toString()}`;
  }

  return (
    <div className="pb-24">
      <PageHeader
        title="Clientes"
        description="Carteira de clientes da B2C Gestão — cadastro, financeiro e recebimentos em um só módulo"
        actions={
          <div className="flex flex-wrap gap-2">
            <ContractUploadDialog />
            <ClientDialog />
          </div>
        }
      />

      <CobrancasTabs active="/clientes" />

      <div className="mb-3 print:hidden">
        <SavedViews module="clientes" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard title="Clientes ativos" value={String(ativos)} intent="positive" />
        <StatCard title="Novos no mês" value={String(novosMes)} />
        <StatCard
          title="Devendo no mês"
          value={String(devendoMes)}
          intent={devendoMes > 0 ? "negative" : "default"}
          hint="Inadimplência da competência atual"
        />
        <StatCard
          title="MRR base (ativos)"
          value={formatBRL(mrrBase)}
          hint="Mensalidade recorrente dos clientes MRR ativos"
        />
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <ClientFilters
            services={services.map((s) => ({ value: s.id, label: s.name }))}
            segments={segments}
            owners={owners}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <ClientsTable clients={clients} allFilteredIds={allFilteredIds} />
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            {total} cliente{total === 1 ? "" : "s"} · página {page} de {totalPages}
          </p>
          <div className="flex gap-2">
            {/* asChild + disabled não bloqueia <Link>: na 1ª/última página
                renderizamos botão desabilitado de verdade. */}
            {page <= 1 ? (
              <Button variant="outline" size="sm" disabled>
                Anterior
              </Button>
            ) : (
              <Button variant="outline" size="sm" asChild>
                <Link href={pageHref(page - 1)}>Anterior</Link>
              </Button>
            )}
            {page >= totalPages ? (
              <Button variant="outline" size="sm" disabled>
                Próxima
              </Button>
            ) : (
              <Button variant="outline" size="sm" asChild>
                <Link href={pageHref(page + 1)}>Próxima</Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
