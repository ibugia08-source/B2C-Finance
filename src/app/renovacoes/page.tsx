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

/**
 * RENOVAÇÕES — módulo do CRM dedicado às renovações de contrato:
 * o mês em foco (quem renova, quem renovou, quem se perdeu), a
 * previsibilidade dos próximos meses e o histórico auditável de renovações.
 * Fonte única: getRenewalPanel (a mesma da seção da Gestão do Mês).
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

  const now = new Date();
  const mes = parseMonthParam(searchParams.mes) ?? {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
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
          where: { status: { in: ["ACTIVE", "RENEWAL", "DELINQUENT", "PAUSED"] } },
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
            <ScheduleRenewalDialog clients={scheduleClients} defaultMonth={mes.month} />
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
      </div>

      {/* ===== Resumo do mês ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard
          title="Renovações no mês"
          value={String(panel.rows.length)}
          hint={`${panel.pendingCount} pendente(s)`}
        />
        <StatCard
          title="Valor esperado"
          value={formatBRL(panel.expectedTotal)}
          hint="TCV cheio · MRR mensalidade"
        />
        <StatCard
          title="Renovadas"
          value={String(panel.renewedCount)}
          intent="positive"
          hint={formatBRL(panel.renewedValue)}
        />
        <StatCard
          title="Não renovadas"
          value={String(panel.lostCount)}
          intent={panel.lostCount > 0 ? "negative" : "default"}
          hint="perdas registradas no mês"
        />
      </div>

      {/* ===== Tabela do mês ===== */}
      <Card>
        <CardContent className="p-0">
          <RenewalsTable
            rows={panel.rows}
            canRenew={gates.renovar}
            canMarkLost={gates.marcarPerda}
            canRegisterPayment={gates.registrarPagamento}
            defaultCompetence={competence}
            emptyMessage="Nenhuma renovação prevista para este mês. Agende manualmente ou ajuste o mês de renovação na carteira."
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
        A lista une a agenda da carteira (mês de renovação do cliente) com a
        data de renovação dos contratos vigentes. &quot;Sim, renovou&quot;
        atualiza contrato + cadastro, pode lançar a cobrança no mês escolhido
        e fica gravado no histórico do cliente.
      </p>
    </div>
  );
}
