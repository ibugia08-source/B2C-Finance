import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { monthRange, parseMonthParam } from "@/lib/format";
import {
  getMonthDelinquencies,
  getClientRiskLevels,
  type MonthDelinquency,
} from "@/lib/services/client-metrics";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { ClientDialog } from "./client-dialog";
import { ClientFilters } from "./filters";
import { SEM_NICHO } from "@/lib/niches";
import { renewalLedgerMonth } from "@/lib/services/renewal-schedule";
import {
  civilCompetenceKey, currentYearMonth, monthBounds as expectationMonthBounds, monthIndex,
  parseCompetenceKey, type YearMonth,
} from "@/lib/renewal-expectation";

/** "YYYY-MM" → esse mês; "1".."12" (link antigo) → próxima ocorrência. */
function mesDaExpectativa(v: string): YearMonth | null {
  const ym = parseCompetenceKey(v);
  if (ym) return ym;
  const m = Number(v);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  const hoje = currentYearMonth();
  const candidato = { year: hoje.year, month: m };
  return monthIndex(candidato) < monthIndex(hoje) ? { year: hoje.year + 1, month: m } : candidato;
}
import { listarNichos } from "@/lib/services/niches";
import { KpiCard } from "@/components/metric-card";
import { ClientsTable, type ClientRow } from "./clients-table";
import { PageSizeSelect } from "./page-size-select";
import { PAGE_SIZES, MONTH_LABEL } from "./_meta";
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
  mes?: string; // competência YYYY-MM (seletor de mês do módulo)
  entrada?: string; // "mes" → só clientes que entraram no mês atual
  perda?: string; // "mes" → só clientes perdidos no mês atual
  pagina?: string;
  porPagina?: string; // 20 | 40 | 100 linhas por página
};

async function ClientesPageInner({
  searchParams,
}: {
  searchParams: Search;
}) {
  const viewer = await requirePagePermission("clientes.visualizar");
  const canCreateClient = can(viewer, "clientes.criar");
  const canDeleteClients = can(viewer, "clientes.excluir");

  // ===== COMPETÊNCIA SELECIONADA (?mes=YYYY-MM) — todo o módulo gira em
  // torno dela: inadimplência, vencimentos, KPIs e ajustes gravados no mês.
  const now0 = new Date();
  const mesSel = parseMonthParam(searchParams.mes);
  const selMonth = mesSel?.month ?? now0.getMonth() + 1;
  const selYear = mesSel?.year ?? now0.getFullYear();
  const isCurrentMonth =
    selMonth === now0.getMonth() + 1 && selYear === now0.getFullYear();
  const selRef = new Date(selYear, selMonth - 1, 1);
  const { start: mesStart, end: mesEnd } = monthRange(selRef);
  const selLabel = `${MONTH_LABEL[selMonth]}/${selYear}`;

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
  // Nicho: id do catálogo, ou o sentinela "sem nicho" (cadastro ainda sem
  // nicho atribuído). Valor antigo por nome continua casando pelo texto.
  if (searchParams.segmento === SEM_NICHO) where.nicheId = null;
  else if (searchParams.segmento) {
    where.OR = [{ nicheId: searchParams.segmento }, { segment: searchParams.segmento }];
  }
  if (searchParams.modalidade) where.modality = searchParams.modalidade;
  if (searchParams.responsavel) where.salesOwner = searchParams.responsavel;
  // Expectativa de renovação no mês "YYYY-MM". Link antigo com só o mês
  // (1-12) vale a PRÓXIMA ocorrência daquele mês a partir de hoje.
  if (searchParams.mesRenovacao) {
    const alvo = mesDaExpectativa(searchParams.mesRenovacao);
    if (alvo) {
      const { start: rs, end: re } = expectationMonthBounds(alvo);
      where.expectedRenewalAt = { gte: rs, lt: re };
    }
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
  // Toda a página usa a COMPETÊNCIA selecionada (não o relógio):
  // inadimplência, vencimento na linha, meses ativos e KPIs do mês.
  const curMonth = selMonth;
  const curYear = selYear;
  const start = mesStart;
  const end = mesEnd;

  // ---------- índice leve de TODOS os clientes do filtro (ordenado) ----------
  // Usado para: (1) inadimplência do mês por cliente, (2) filtro Pago/Devendo,
  // (3) seleção "todos os filtrados". Campos mínimos → barato mesmo com muitos.
  const [index, monthOverrides, segmentRows, ownerRows, ativos, novosMes, perdidosMes, renovacoesProx] =
    await Promise.all([
      prisma.client.findMany({
        where,
        orderBy: { name: searchParams.ordem === "za" ? "desc" : "asc" },
        select: { id: true },
      }),
      // Overrides manuais de inadimplência DA COMPETÊNCIA selecionada
      // (histórico por mês em ClientMonthDelinquency).
      prisma.clientMonthDelinquency.findMany({
        where: { year: curYear, month: curMonth },
        select: { clientId: true, status: true, setBy: true },
      }),
      listarNichos(),
      prisma.client.findMany({
        where: { salesOwner: { not: null } },
        distinct: ["salesOwner"],
        select: { salesOwner: true },
        orderBy: { salesOwner: "asc" },
      }),
      // Ativos: mês corrente = status ACTIVE; mês passado = quem estava na
      // base naquele mês (entrou antes do fim; não havia saído antes do início).
      isCurrentMonth
        ? prisma.client.count({ where: { status: "ACTIVE" } })
        : prisma.client.count({
            where: {
              status: { notIn: ["PROSPECT", "LEAD"] },
              OR: [
                { startedAt: { lt: mesEnd } },
                { startedAt: null, createdAt: { lt: mesEnd } },
              ],
              AND: [{ OR: [{ churnedAt: null }, { churnedAt: { gte: mesStart } }] }],
            },
          }),
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
      // Renovações do mês: o MESMO livro do módulo Renovações (expectativas
      // do mês + desfechos registrados contra elas).
      renewalLedgerMonth({ month: curMonth, year: curYear }).then((l) => l.rows.length),
    ]);

  const autoDelinq = await getMonthDelinquencies(
    index.map((c) => c.id),
    curMonth,
    curYear
  );

  // Overrides manuais da competência (ClientMonthDelinquency → mapa por cliente).
  const overrideByClient = new Map(
    monthOverrides.map((o) => [o.clientId, { status: o.status, by: o.setBy }])
  );

  // Inadimplência EFETIVA da competência: override manual do mês vence o auto.
  type IndexRow = (typeof index)[number];
  function effectiveDelinquency(c: IndexRow): {
    value: DelinquencyValue | "SEM_COBRANCA";
    manual: boolean;
    by: string | null;
  } {
    const ov = overrideByClient.get(c.id);
    if (ov) {
      return { value: ov.status as DelinquencyValue, manual: true, by: ov.by ?? null };
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
      expectedRenewalAt: true,
      monthlyValue: true,
      totalContractValue: true,
      paymentDay: true,
      contractMonths: true,
      contractIndefinite: true,
      startedAt: true,
      notes: true,
    },
  });
  // Colunas estilo planilha (F5) — em lote e SEQUENCIAL (pool do Prisma).
  // Serviços ativos: query direta leve (a carteira só usa os NOMES — o
  // getClientSummaries completo dispara 5 queries e 4 seriam descartadas).
  const activeContracts = await prisma.contract.findMany({
    where: { clientId: { in: pageIds }, status: "ACTIVE" },
    select: {
      clientId: true,
      services: { select: { service: { select: { name: true } } } },
    },
  });
  const servicesById = new Map<string, string[]>();
  for (const ct of activeContracts) {
    const cur = servicesById.get(ct.clientId) ?? [];
    for (const s of ct.services) {
      if (!cur.includes(s.service.name)) cur.push(s.service.name);
    }
    servicesById.set(ct.clientId, cur);
  }
  const risksById = await getClientRiskLevels(pageIds);
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
        renewalCompetence: r.expectedRenewalAt ? civilCompetenceKey(r.expectedRenewalAt) : null,
        contractIndefinite: r.contractIndefinite,
        monthlyValue: monthly,
        totalContractValue: total,
        refValue: refValue != null ? refValue : null,
        paymentDay: r.paymentDay,
        contractMonths: r.contractMonths,
        dueDay: dueThisMonth ? dueThisMonth.getDate() : null,
        monthsActive,
        delinquency: effectiveDelinquency(indexById.get(r.id)!),
        // Ajuste de inadimplência na linha é gravado NESTA competência.
        refMonth: curMonth,
        refYear: curYear,
        services: servicesById.get(r.id) ?? [],
        risk: (() => {
          const risk = risksById.get(r.id);
          return risk ? { level: risk.riskLevel, label: risk.payerLabel } : null;
        })(),
        notes: r.notes,
      };
    });

  const segments = segmentRows;
  const owners = ownerRows.map((r) => r.salesOwner!).filter(Boolean);

  // Sufixo de competência para os links dos cards (preserva o mês selecionado).
  const mesQS = isCurrentMonth
    ? ""
    : `&mes=${selYear}-${String(selMonth).padStart(2, "0")}`;

  function pageHref(p: number) {
    const params = new URLSearchParams(searchParams as Record<string, string>);
    params.set("pagina", String(p));
    return `/clientes?${params.toString()}`;
  }

  // Sem pb-24 na raiz: o <main> do AppShell já reserva o espaço da tab bar
  // (pb-24 mobile / pb-6 desktop) e a FloatingActionBar renderiza em portal —
  // o padding duplicado criava um vão morto no rodapé.
  return (
    <div>
      <PageHeader
        title="Clientes"
        description={`Carteira de clientes da B2C Gestão · competência ${selLabel}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {/* Seletor da competência: ◀ [Mês][Ano] ▶ — tudo na página (lista,
                inadimplência, vencimentos, KPIs e ajustes) pertence a este mês. */}
            {canCreateClient && <ClientDialog />}
          </div>
        }
      />

      {!isCurrentMonth && (
        <div className="mb-3 rounded-xl border border-primary/25 bg-primary/[0.04] px-4 py-2.5 text-sm">
          Você está gerenciando <strong>{selLabel}</strong> — a inadimplência, os
          vencimentos e os ajustes feitos aqui ficam gravados nessa competência.
        </div>
      )}

      {/* ===== Métricas da carteira (4) — clicáveis, com tooltip "?" ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <KpiCard
          title={isCurrentMonth ? "Clientes ativos" : `Ativos em ${MONTH_LABEL[selMonth]}`}
          value={String(ativos)}
          tone="pos"
          help={
            isCurrentMonth
              ? "Total de clientes com status ativo na carteira."
              : "Clientes que estavam na base durante o mês selecionado (entraram antes do fim do mês e não haviam saído)."
          }
          hint={isCurrentMonth ? "clique para filtrar os ativos" : selLabel}
          href={`/clientes?status=ACTIVE${mesQS}`}
        />
        <KpiCard
          title="Novos no mês"
          value={String(novosMes)}
          tone={novosMes > 0 ? "pos" : "default"}
          help="Clientes que entraram na carteira no mês selecionado (data de entrada; sem ela, data de cadastro)."
          hint={`entradas em ${selLabel}`}
          href={`/clientes?entrada=mes${mesQS}`}
        />
        <KpiCard
          title="Perdidos no mês"
          value={String(perdidosMes)}
          tone={perdidosMes > 0 ? "neg" : "default"}
          help="Clientes perdidos no mês selecionado (data da saída registrada na perda)."
          hint={`saídas em ${selLabel}`}
          href={`/clientes?perda=mes${mesQS}`}
        />
        <KpiCard
          title="Renovações do mês"
          value={String(renovacoesProx)}
          tone={renovacoesProx > 0 ? "warn" : "default"}
          help="Clientes com data de expectativa de renovação no mês selecionado (entrada + prazo do contrato, ou agendada), incluindo quem já renovou e quem não renovou. É a mesma lista do módulo Renovações."
          hint={`renovações em ${selLabel}`}
          href={`/renovacoes?mes=${curYear}-${String(curMonth).padStart(2, "0")}`}
        />
      </div>

      <Card className="mb-3">
        <CardContent className="p-4">
          <ClientFilters niches={segments} owners={owners} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <ClientsTable clients={clients} allFilteredIds={allFilteredIds} canDelete={canDeleteClients} />
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

// T7 — o p95 desta tela é medido contra o orçamento de 03 §4.7.
export default async function ClientesPage(
  ...args: Parameters<typeof ClientesPageInner>
) {
  const { medir } = await import("@/lib/observability");
  return medir("page:clientes", () => ClientesPageInner(...args));
}
