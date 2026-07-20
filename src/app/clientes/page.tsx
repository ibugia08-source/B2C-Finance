import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { monthRange } from "@/lib/format";
import {
  getMonthDelinquencies,
  type MonthDelinquency,
} from "@/lib/services/client-metrics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/viewer";
import { ClientDialog } from "./client-dialog";
import { ClientFilters } from "./filters";
import { KpiCard } from "./kpi-card";
import { ClientsTable, type ClientRow } from "./clients-table";
import { CobrancasTabs } from "@/app/cobrancas/module-tabs";
import { PageSizeSelect } from "./page-size-select";
import { PAGE_SIZES } from "./_meta";
import { getValidDueDateForMonth } from "@/lib/financial/due-date";
import type { DelinquencyValue } from "./_meta";

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
  entrada?: string; // "mes" → só clientes que entraram no mês atual
  perda?: string; // "mes" → só clientes perdidos no mês atual
  pagina?: string;
  porPagina?: string; // 20 | 40 | 100 linhas por página
};

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  await requireAdmin();

  const now0 = new Date();
  const { start: mesStart, end: mesEnd } = monthRange(now0);

  // ---------- where (filtros que rodam no banco) ----------
  const where: any = {};
  // Perdidos saem da lista padrão (botão "Perda de cliente"); para revê-los,
  // use o filtro de status "Perdido / Cancelado" ou o card "Perdidos este mês".
  if (searchParams.perda === "mes") {
    // Card "Clientes perdidos este mês": perdidos com saída no mês atual.
    where.status = "CHURNED";
    where.churnedAt = { gte: mesStart, lt: mesEnd };
  } else if (searchParams.status) {
    where.status = searchParams.status;
  } else {
    where.status = { not: "CHURNED" };
  }
  // Card "Novos clientes este mês": entrada no mês (startedAt; fallback createdAt).
  if (searchParams.entrada === "mes") {
    where.AND = [
      ...(where.AND ?? []),
      {
        OR: [
          { startedAt: { gte: mesStart, lt: mesEnd } },
          { startedAt: null, createdAt: { gte: mesStart, lt: mesEnd } },
        ],
      },
    ];
  }
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
  // Linhas por página: 20 (padrão), 40 ou 100 — escolhido no rodapé da lista.
  const requestedSize = parseInt(searchParams.porPagina ?? "", 10);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(requestedSize)
    ? requestedSize
    : 20;
  const now = new Date();
  const curMonth = now.getMonth() + 1;
  const curYear = now.getFullYear();
  const { start, end } = monthRange();

  // ---------- índice leve de TODOS os clientes do filtro (ordenado) ----------
  // Usado para: (1) inadimplência do mês por cliente, (2) filtro Pago/Devendo,
  // (3) seleção "todos os filtrados". Campos mínimos → barato mesmo com muitos.
  const [index, segmentRows, ownerRows, ativos, novosMes, perdidosMes, renovacoesProx] =
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
      // Novos do mês: entrada (startedAt; fallback createdAt) no mês atual.
      prisma.client.count({
        where: {
          OR: [
            { startedAt: { gte: start, lt: end } },
            { startedAt: null, createdAt: { gte: start, lt: end } },
          ],
        },
      }),
      // Perdidos este mês: saída (churnedAt) dentro do mês atual.
      prisma.client.count({
        where: { status: "CHURNED", churnedAt: { gte: start, lt: end } },
      }),
      // Renovações próximas: mês de renovação = mês atual (clientes da base).
      prisma.client.count({
        where: {
          renewalMonth: curMonth,
          status: { notIn: ["CHURNED", "INACTIVE", "PROSPECT", "LEAD"] },
        },
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
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSlice = filtered.slice((page - 1) * pageSize, page * pageSize);
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
        actions={<ClientDialog />}
      />

      <CobrancasTabs active="/clientes" />

      {/* ===== Métricas da carteira (4) — clicáveis, com tooltip "?" ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <KpiCard
          title="Clientes ativos"
          value={String(ativos)}
          tone="pos"
          help="Total de clientes com status ativo na carteira."
          hint="clique para filtrar os ativos"
          href="/clientes?status=ACTIVE"
        />
        <KpiCard
          title="Novos clientes este mês"
          value={String(novosMes)}
          tone={novosMes > 0 ? "pos" : "default"}
          help="Quantidade de clientes que entraram na carteira neste mês (data de entrada; sem ela, data de cadastro)."
          hint="clique para ver os novos do mês"
          href="/clientes?entrada=mes"
        />
        <KpiCard
          title="Clientes perdidos este mês"
          value={String(perdidosMes)}
          tone={perdidosMes > 0 ? "neg" : "default"}
          help="Quantidade de clientes que foram perdidos neste mês (data da saída registrada na perda)."
          hint="clique para ver os perdidos do mês"
          href="/clientes?perda=mes"
        />
        <KpiCard
          title="Renovações próximas"
          value={String(renovacoesProx)}
          tone={renovacoesProx > 0 ? "warn" : "default"}
          help="Clientes com renovação prevista para o período próximo (mês de renovação = mês atual)."
          hint="clique para ver as renovações"
          href={`/clientes?mesRenovacao=${curMonth}`}
        />
      </div>

      <Card className="mb-4">
        <CardContent className="p-4">
          <ClientFilters segments={segments} owners={owners} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <ClientsTable clients={clients} allFilteredIds={allFilteredIds} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <p className="text-sm text-muted-foreground">
          {total} cliente{total === 1 ? "" : "s"} · página {page} de {totalPages}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <PageSizeSelect value={pageSize} />
          {totalPages > 1 && (
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
          )}
        </div>
      </div>
    </div>
  );
}
