import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/metric-card";
import { ChartCard, HBarList } from "@/components/charts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR } from "@/lib/format";
import { requirePagePermission } from "@/lib/auth/viewer";
import { getRetentionPanel } from "@/lib/services/retention-metrics";
import { previsaoDeChurn } from "@/lib/services/churn-signals";
import { serieDeNrr } from "@/lib/services/nrr";
import { ROW_OVERDUE, ROW_SOON } from "@/lib/status-meta";
import { HeartCrack, ChevronLeft, ChevronRight } from "lucide-react";

/**
 * RETENÇÃO — módulo criado na reestruturação de 2026: a auditoria dos dados
 * mostrou que o churn (vida mediana de 4 meses, 28% de perda em agosto) era
 * a principal causa do prejuízo e não aparecia em nenhuma tela. Aqui vivem:
 * churn mês a mês, vida/LTV, coortes, perdas por responsável e segmento e a
 * ZONA DE RISCO (clientes ativos na faixa de vida em que a base morre).
 */
export default async function RetencaoPage({
  searchParams,
}: {
  searchParams: { ano?: string };
}) {
  await requirePagePermission("clientes.visualizar");

  const now = new Date();
  const anoParam = parseInt(searchParams.ano ?? "", 10);
  const year =
    Number.isInteger(anoParam) && anoParam >= 2000 && anoParam <= 2100
      ? anoParam
      : now.getFullYear();

  const panel = await getRetentionPanel(year);
  // F5.4 — NRR pelas vigências dos termos e previsão de churn por sinais.
  const competenciaFinal =
    year === now.getFullYear()
      ? `${year}-${String(now.getMonth() + 1).padStart(2, "0")}`
      : `${year}-12`;
  const [previsao, nrrSerie] = await Promise.all([
    previsaoDeChurn(now),
    serieDeNrr(competenciaFinal, 6),
  ]);
  // TODO sinal aceso aparece — inclusive quem só tem o tempo de casa (o
  // antigo "zona de risco" vive aqui dentro como sinal, não como lista à parte).
  const emRisco = previsao.filter((c) => c.pontos > 0);
  const semLeitura = previsao.filter((c) => c.semLeitura).length;
  // Perdas recentes (lista auditável — mesma fonte do painel)
  const recentLosses = await prisma.clientLoss.findMany({
    orderBy: { lostAt: "desc" },
    take: 10,
    select: {
      id: true, lostAt: true, monthlyValue: true, reason: true, salesOwner: true,
      client: { select: { id: true, name: true, segment: true } },
    },
  });

  const churnPct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;
  const monthsShown = panel.months.filter(
    (m) => panel.lastMonthWithData >= 0 && m.month <= panel.lastMonthWithData
  );
  const mediaChurn =
    monthsShown.length > 0
      ? monthsShown.reduce((s, m) => s + m.churnRate, 0) / monthsShown.length
      : 0;
  const saldoLiquido = monthsShown.reduce((s, m) => s + m.novos - m.perdas, 0);

  return (
    <div>
      <PageHeader
        title="Retenção"
        description={`Churn, vida da carteira e zona de risco — ${year}`}
        actions={
          <div className="inline-flex items-center gap-1.5">
            <Button variant="outline" size="icon" className="h-9 w-9" asChild>
              <Link href={`/retencao?ano=${year - 1}`} aria-label="Ano anterior">
                <ChevronLeft className="h-4 w-4" />
              </Link>
            </Button>
            <span className="flex h-9 items-center rounded-md border bg-background px-3 text-sm font-semibold tabular-nums">
              {year}
            </span>
            <Button variant="outline" size="icon" className="h-9 w-9" asChild>
              <Link href={`/retencao?ano=${year + 1}`} aria-label="Próximo ano">
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        }
      />

      {/* ===== KPIs ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <StatCard
          title="Churn do mês"
          value={churnPct(panel.churnAtual)}
          intent={panel.churnAtual > 0.1 ? "negative" : panel.churnAtual > 0.05 ? "warning" : "positive"}
          hint="perdas ÷ ativos no início do mês"
        />
        <StatCard
          title="Churn médio no ano"
          value={churnPct(mediaChurn)}
          intent={mediaChurn > 0.08 ? "negative" : mediaChurn > 0.04 ? "warning" : "positive"}
        />
        <StatCard
          title="Clientes perdidos"
          value={String(panel.totalPerdas)}
          intent={panel.totalPerdas > 0 ? "negative" : "positive"}
          hint={`${formatBRL(panel.totalMrrPerdido)} de receita mensal`}
        />
        <StatCard
          title="Vida mediana"
          value={`${panel.lifetime.medianMonths.toFixed(1).replace(".", ",")} meses`}
          intent={panel.lifetime.medianMonths < 6 ? "negative" : panel.lifetime.medianMonths < 12 ? "warning" : "positive"}
          hint={`${panel.lifetime.n} perdas medidas`}
        />
        <StatCard
          title="LTV estimado"
          value={formatBRL(panel.ltvEstimado)}
          hint="ticket médio × vida mediana"
        />
        <StatCard
          title="Saldo líquido do ano"
          value={`${saldoLiquido >= 0 ? "+" : ""}${saldoLiquido}`}
          intent={saldoLiquido >= 0 ? "positive" : "negative"}
          hint="novos − perdidos"
        />
      </div>

      {/* ===== Churn mês a mês ===== */}
      <Card className="mb-6">
        <CardContent className="p-0">
          <div className="px-5 pt-4 pb-2">
            <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">
              Churn mês a mês
            </h2>
            <p className="text-xs text-muted-foreground">
              Entradas, saídas e taxa de perda sobre a base do início de cada mês
            </p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Ativos (início)</TableHead>
                  <TableHead className="text-right">Novos</TableHead>
                  <TableHead className="text-right">Perdas</TableHead>
                  <TableHead className="text-right">Churn</TableHead>
                  <TableHead className="text-right">MRR novo</TableHead>
                  <TableHead className="text-right">MRR perdido</TableHead>
                  <TableHead className="text-right">Saldo MRR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthsShown.map((m) => {
                  const saldo = m.mrrNovo - m.mrrPerdido;
                  const rowClass =
                    m.churnRate > 0.1 ? ROW_OVERDUE : m.churnRate > 0.05 ? ROW_SOON : "";
                  return (
                    <TableRow key={m.month} className={rowClass}>
                      <TableCell className="font-medium">{m.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.ativosInicio}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.novos}</TableCell>
                      <TableCell className="text-right tabular-nums">{m.perdas}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {m.ativosInicio > 0 ? churnPct(m.churnRate) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatBRL(m.mrrNovo)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBRL(m.mrrPerdido)}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${saldo < 0 ? "text-destructive" : ""}`}
                      >
                        {saldo >= 0 ? "+" : ""}{formatBRL(saldo)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ===== NRR — retenção líquida de receita (F5.4) ===== */}
      <div className="mb-2">
        <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">
          Retenção líquida de receita (NRR)
        </h2>
        <p className="text-xs text-muted-foreground">
          O que aconteceu com a receita da base que JÁ existia: reajustes para
          cima (expansão), para baixo (contração) e saídas. Lê o valor vigente
          de cada mês — cliente novo no mês fica fora da conta. Por competência.
        </p>
      </div>
      <Card className="mb-6">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Base inicial</TableHead>
                  <TableHead className="text-right">Expansão</TableHead>
                  <TableHead className="text-right">Contração</TableHead>
                  <TableHead className="text-right">Saídas</TableHead>
                  <TableHead className="text-right">NRR</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nrrSerie.map((m) => (
                  <TableRow key={m.competence}>
                    <TableCell className="font-medium">{m.competence}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatBRL(m.inicial)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.expansao > 0 ? `+${formatBRL(m.expansao)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.contracao > 0 ? `−${formatBRL(m.contracao)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.churn > 0 ? `−${formatBRL(m.churn)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {m.nrr == null ? (
                        <span className="text-muted-foreground" title={m.motivoDoNulo ?? undefined}>—</span>
                      ) : (
                        `${(m.nrr * 100).toFixed(1).replace(".", ",")}%`
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* ===== Previsão de churn por sinais (F5.4) ===== */}
      <div className="mb-2">
        <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">
          Quem olhar hoje — sinais de churn
        </h2>
        <p className="text-xs text-muted-foreground">
          Régua declarada, não estatística: atraso, resultados, anúncios e
          tempo de casa somam pontos, e a nota mostra sempre o porquê.
          {semLeitura > 0
            ? ` ${semLeitura} ${semLeitura === 1 ? "cliente está" : "clientes estão"} sem avaliação recente — sinal de processo, não de saúde.`
            : ""}
        </p>
      </div>
      <Card className="mb-6">
        <CardContent className="p-0">
          {emRisco.length === 0 ? (
            <EmptyState
              icon={HeartCrack}
              title="Nenhum cliente com sinais acesos"
              description="Nenhum cliente ativo soma pontos de atenção hoje. Os sinais leem atraso, avaliação mensal e tempo de casa."
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Nível</TableHead>
                    <TableHead>Sinais</TableHead>
                    <TableHead className="text-right">Valor mensal</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emRisco.slice(0, 20).map((c) => (
                    <TableRow
                      key={c.relationshipId}
                      className={c.nivel === "ALTO" ? ROW_OVERDUE : c.nivel === "ATENCAO" ? ROW_SOON : ""}
                    >
                      <TableCell className="font-medium">
                        <Link href={`/clientes/${c.clientId}`} className="hover:underline">
                          {c.cliente}
                        </Link>
                        {c.semLeitura ? (
                          <Badge variant="outline" className="ml-1.5">sem avaliação</Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            c.nivel === "ALTO"
                              ? "destructive"
                              : c.nivel === "ATENCAO"
                                ? "warning"
                                : "secondary"
                          }
                        >
                          {c.nivel === "ALTO" ? "Alto" : c.nivel === "ATENCAO" ? "Atenção" : "Observação"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[360px]">
                        <span className="text-dense text-muted-foreground">
                          {c.sinais.map((x) => x.sinal).join(" · ")}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {c.valorMensal > 0 ? formatBRL(c.valorMensal) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" asChild>
                          <Link href={`/clientes/${c.clientId}?tab=contexto`}>Abrir ficha</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===== Quebras: responsável · segmento · vida · coortes ===== */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <ChartCard title="Perdas por responsável" hint={`clientes perdidos em ${year}`}>
          <HBarList
            items={panel.byOwner.map((r) => ({ label: r.label, value: r.count }))}
            colorClass="bg-destructive"
            format={(v) => String(v)}
            emptyText="Nenhuma perda registrada no ano."
          />
        </ChartCard>
        <ChartCard title="Perdas por segmento" hint={`clientes perdidos em ${year}`}>
          <HBarList
            items={panel.bySegment.map((r) => ({ label: r.label, value: r.count }))}
            colorClass="bg-destructive"
            format={(v) => String(v)}
            emptyText="Nenhuma perda registrada no ano."
          />
        </ChartCard>
        <ChartCard
          title="Quanto tempo os clientes ficam"
          hint={`distribuição da vida dos ${panel.lifetime.n} clientes perdidos (histórico)`}
        >
          <HBarList
            items={[
              { label: "Até 3 meses", value: panel.lifetime.ate3 },
              { label: "4 a 6 meses", value: panel.lifetime.de4a6 },
              { label: "7 a 12 meses", value: panel.lifetime.de7a12 },
              { label: "Mais de 12 meses", value: panel.lifetime.acima12 },
            ]}
            colorClass="bg-warning"
            format={(v) => String(v)}
            emptyText="Sem perdas medidas ainda."
          />
        </ChartCard>
        <ChartCard title="Sobrevivência por coorte de entrada" hint="% da coorte ainda ativa hoje">
          {panel.cohorts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Sem dados de entrada.</p>
          ) : (
            <div className="space-y-2.5">
              {panel.cohorts.map((c) => (
                <div key={c.label} title={`${c.stillActive} de ${c.entered} ainda ativos`}>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-sm">{c.label}</span>
                    <span className="text-sm font-medium tabular-nums">
                      {Math.round(c.survival * 100)}%
                      <span className="text-xs text-muted-foreground ml-1.5">
                        {c.stillActive}/{c.entered}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full ${c.survival >= 0.6 ? "bg-primary" : c.survival >= 0.4 ? "bg-warning" : "bg-destructive"}`}
                      style={{ width: `${Math.max(2, c.survival * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      {/* ===== Últimas perdas ===== */}
      <div className="mb-2">
        <h2 className="font-display text-lg font-semibold tracking-[-0.01em]">Últimas perdas</h2>
        <p className="text-xs text-muted-foreground">
          Registre o motivo real de cada saída — é o insumo mais valioso deste painel
        </p>
      </div>
      <Card>
        <CardContent className="p-0">
          {recentLosses.length === 0 ? (
            <EmptyState icon={HeartCrack} title="Nenhuma perda registrada" description="Quando um cliente for marcado como perdido, ele aparece aqui." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead>Segmento</TableHead>
                    <TableHead>Responsável</TableHead>
                    <TableHead className="text-right">Receita mensal</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentLosses.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="tabular-nums">{formatDateBR(l.lostAt)}</TableCell>
                      <TableCell className="font-medium">
                        <Link href={`/clientes/${l.client.id}`} className="hover:underline">
                          {l.client.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{l.client.segment ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{l.salesOwner ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {l.monthlyValue != null ? formatBRL(Number(l.monthlyValue)) : "—"}
                      </TableCell>
                      <TableCell className="max-w-[320px] truncate text-muted-foreground" title={l.reason ?? undefined}>
                        {l.reason ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">
        Vida e LTV são medidos sobre os clientes perdidos com datas de entrada e
        saída registradas; o LTV é uma estimativa (ticket médio × vida mediana).
        Perdas são registradas automaticamente quando o status do cliente muda
        para Perdido na <Link href="/clientes" className="underline">Gestão de Carteira</Link>.
      </p>
    </div>
  );
}
