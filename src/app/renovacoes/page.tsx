import { PORTFOLIO_ACTIVE_STATUSES } from "@/lib/client-status";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/metric-card";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR, parseMonthParam, MONTHS_PT_SHORT } from "@/lib/format";
import { requirePagePermission, can } from "@/lib/auth/viewer";
import { getRenewalPanel, getRenewalStrip } from "@/lib/services/renewal-metrics";
import { RenewalsTable } from "./renewals-table";
import { ScheduleRenewalDialog } from "./schedule-renewal-dialog";
import { currentYearMonth } from "@/lib/renewal-expectation";

/**
 * RENOVAÇÕES — módulo dedicado às renovações de contrato (25/09/2026).
 *
 * A lista do mês é a de clientes com DATA DE EXPECTATIVA de renovação no mês
 * selecionado (entrada + prazo do contrato, ou agendada à mão), mais os
 * desfechos registrados contra essas expectativas. Os cards do topo são as
 * métricas PRÓPRIAS do módulo: valor esperado, valor ganho, valor perdido e
 * quantidade de renovações ganhas. Fonte única: o livro de renovações
 * (services/renewal-schedule), o mesmo da Gestão do Mês e da Visão geral.
 */

type Search = { mes?: string };

export default async function RenovacoesPage({ searchParams }: { searchParams: Search }) {
  const viewer = await requirePagePermission("clientes.visualizar");
  const gates = {
    renovar: can(viewer, "contratos.editar"),
    marcarPerda: can(viewer, "clientes.alterar_status"),
    agendar: can(viewer, "clientes.editar"),
    registrarPagamento: can(viewer, "recebimentos.registrar_pagamento"),
  };

  // Mês padrão no calendário do workspace — o servidor roda em UTC e, às
  // 22h do último dia do mês na Bahia, já estaria no mês seguinte.
  const mes = parseMonthParam(searchParams.mes) ?? currentYearMonth();
  const competence = `${mes.year}-${String(mes.month).padStart(2, "0")}`;
  const monthLabelStr = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(mes.year, mes.month - 1, 1));

  // FASE A — painel do mês; FASE B — previsibilidade + apoio (sequencial, pool ≈5).
  const panel = await getRenewalPanel(mes.month, mes.year);
  const [strip, scheduleClients, recentRenewals] = await Promise.all([
    getRenewalStrip(mes.month, mes.year, 6),
    gates.agendar
      ? prisma.client.findMany({
          where: { status: { in: [...PORTFOLIO_ACTIVE_STATUSES] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
          take: 2000,
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    prisma.clientRenewal.findMany({
      orderBy: { renewedAt: "desc" },
      take: 15,
      select: {
        id: true,
        renewedAt: true,
        months: true,
        totalValue: true,
        modality: true,
        paymentMethod: true,
        billingMonth: true,
        billingYear: true,
        client: { select: { id: true, name: true } },
      },
    }),
  ]);

  return (
    <div>
      <PageHeader
        title="Renovações"
        description={`Renovações de ${monthLabelStr}: quem renova, quem renovou e a previsibilidade dos próximos meses`}
        actions={
          gates.agendar ? (
            <ScheduleRenewalDialog clients={scheduleClients} defaultCompetence={competence} />
          ) : undefined
        }
      />

      {/* ===== Métricas do mês (próprias do módulo) ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard
          title="Valor esperado de renovação"
          value={formatBRL(panel.expectedTotal)}
          hint={`${panel.rows.length} cliente(s) com expectativa · ${panel.pendingCount} pendente(s)`}
        />
        <StatCard
          title="Valor ganho"
          value={formatBRL(panel.gainedValue)}
          intent={panel.gainedValue > 0 ? "positive" : "default"}
          hint="soma das renovações registradas"
        />
        <StatCard
          title="Valor perdido"
          value={formatBRL(panel.lostValue)}
          intent={panel.lostValue > 0 ? "negative" : "default"}
          hint={`${panel.lostCount} cliente(s) não renovaram`}
        />
        <StatCard
          title="Renovações ganhas"
          value={String(panel.renewedCount)}
          intent={panel.renewedCount > 0 ? "positive" : "default"}
          hint={
            panel.rows.length > 0
              ? `${Math.round((panel.renewedCount / panel.rows.length) * 100)}% das expectativas do mês`
              : "sem expectativas no mês"
          }
        />
      </div>

      {panel.overdue && panel.overdue.count > 0 && (
        <p role="status" className="mb-4 rounded-card border border-warning/30 bg-warning-soft px-3.5 py-3 text-dense text-warning-ink">
          {panel.overdue.count} expectativa(s) de meses anteriores continuam sem desfecho,
          somando {formatBRL(panel.overdue.value)}. Volte aos meses anteriores pela barra de
          mês e registre &quot;Sim, renovou&quot; ou &quot;Não renovou&quot;.
        </p>
      )}

      {/* ===== Tabela do mês ===== */}
      <Card>
        <CardContent className="p-0">
          <RenewalsTable
            rows={panel.rows}
            canRenew={gates.renovar}
            canMarkLost={gates.marcarPerda}
            canRegisterPayment={gates.registrarPagamento}
            defaultCompetence={competence}
            emptyMessage="Nenhum cliente com expectativa de renovação neste mês. A expectativa vem da data de entrada + prazo do contrato; use Agendar renovação para incluir um cliente."
          />
        </CardContent>
      </Card>

      {/* ===== Previsibilidade — próximos meses ===== */}
      <div className="mt-6">
        <h2 className="mb-2 font-display text-lg font-semibold tracking-[-0.01em]">
          Próximos meses
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {strip.map((s) => {
            const href = `/renovacoes?mes=${s.year}-${String(s.month).padStart(2, "0")}`;
            const isCurrent = s.month === mes.month && s.year === mes.year;
            return (
              <Link key={href} href={href}>
                <Card
                  className={`h-full transition-colors hover:border-primary/40 ${isCurrent ? "border-primary/60" : ""}`}
                >
                  <CardContent className="p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      {MONTHS_PT_SHORT[s.month - 1]}/{s.year}
                    </p>
                    <p className="stat-number text-lg font-semibold">{s.count}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {s.expectedTotal > 0 ? formatBRL(s.expectedTotal) : "—"}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>

      {/* ===== Histórico de renovações ===== */}
      <div className="mt-6">
        <h2 className="mb-2 font-display text-lg font-semibold tracking-[-0.01em]">
          Últimas renovações registradas
        </h2>
        <Card>
          <CardContent className="p-0">
            {recentRenewals.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                Nenhuma renovação registrada ainda — o histórico começa no
                primeiro &quot;Sim, renovou&quot;.
              </p>
            ) : (
              <ul className="divide-y">
                {recentRenewals.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <Link
                        href={`/clientes/${r.client.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.client.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {formatDateBR(r.renewedAt)} · {r.months} mês(es)
                        {r.modality ? ` · ${r.modality}` : ""}
                        {r.paymentMethod ? ` · ${r.paymentMethod}` : ""}
                        {r.billingMonth
                          ? ` · lançado em ${String(r.billingMonth).padStart(2, "0")}/${r.billingYear}`
                          : ""}
                      </p>
                    </div>
                    <span className="stat-number font-semibold">
                      {formatBRL(Number(r.totalValue))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Expectativa de renovação = data de entrada + prazo do contrato (a cada
        ciclo). &quot;Sim, renovou&quot; atualiza contrato e cadastro, move a
        próxima expectativa para frente pelo novo prazo, pode lançar a cobrança
        no mês escolhido e conta como ganha NESTE mês. &quot;Não renovou&quot;
        conta como perdida neste mês.
      </p>
    </div>
  );
}
