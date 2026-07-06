import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth/viewer";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import { getReport } from "@/lib/reports/registry";
import { parseReportQuery, parsePresentation, type SearchParams } from "@/lib/reports/query";
import { presentReport } from "@/lib/reports/present";
import { ReportControls } from "@/components/report/report-controls";
import { ReportTable } from "@/components/report/report-table";
import { SavedViews } from "@/components/saved-views";
import { ChartCard, HBarList } from "@/components/charts";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default async function RelatorioPage({
  params,
  searchParams,
}: {
  params: { tipo: string };
  searchParams?: SearchParams;
}) {
  await requireAdmin();
  const def = getReport(params.tipo);
  if (!def) notFound();

  await markOverdueBillings();

  const sp = searchParams ?? {};
  const query = parseReportQuery(sp);
  const pres = parsePresentation(sp);
  const rows = await def.build(query);
  const presented = presentReport(def, rows, pres);

  // Opções dos selects (pequenas, só id+nome)
  const needs = (f: string) => def.filterFields.includes(f as any);
  const [clients, services, contracts, categories] = await Promise.all([
    needs("cliente") ? prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    needs("servico") ? prisma.service.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
    needs("contrato") ? prisma.contract.findMany({ select: { id: true, title: true }, orderBy: { title: "asc" } }) : [],
    needs("categoria") ? prisma.category.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);

  // Gráfico: distribuição da 1ª coluna monetária pela 1ª coluna de texto
  // (ou pelos grupos, quando agrupado).
  const moneyCol = presented.columns.find((c) => c.kind === "money" && c.total);
  const labelCol = presented.columns.find((c) => c.kind === "text");
  let chartItems: { label: string; value: number }[] = [];
  if (pres.grafico && moneyCol) {
    const grouped = presented.groups[0]?.label !== null;
    if (grouped) {
      chartItems = presented.groups.map((g) => ({
        label: g.label ?? "—",
        value: Math.abs(g.subtotals[moneyCol.key] ?? 0),
      }));
    } else if (labelCol) {
      const map = new Map<string, number>();
      for (const r of rows) {
        const label = String(r[labelCol.key] ?? "—");
        map.set(label, (map.get(label) ?? 0) + Math.abs(Number(r[moneyCol.key] ?? 0)));
      }
      chartItems = Array.from(map.entries())
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8);
    }
  }

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title={def.title}
          description={`${def.description} · ${query.period.label}`}
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link href="/relatorios"><ArrowLeft className="h-4 w-4 mr-1" /> Relatórios</Link>
            </Button>
          }
        />
        <div className="mb-3">
          <SavedViews module={`relatorio-${def.key}`} />
        </div>
        <Card className="mb-5">
          <CardContent className="p-4">
            <ReportControls
              reportKey={def.key}
              filterFields={def.filterFields}
              columns={def.columns.map((c) => ({ key: c.key, label: c.label }))}
              groupOptions={def.groupOptions.map((k) => ({
                key: k,
                label: def.columns.find((c) => c.key === k)?.label ?? k,
              }))}
              statusOptions={def.statusOptions}
              tipoOptions={def.tipoOptions}
              clients={clients}
              services={services}
              contracts={contracts.map((c: any) => ({ id: c.id, name: c.title }))}
              categories={categories}
            />
          </CardContent>
        </Card>
      </div>

      {/* Cabeçalho de impressão */}
      <div className="hidden print:block mb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/b2c-logo.svg" alt="B2C" className="h-7 mb-2" />
        <h1 className="text-xl font-bold">{def.title} — B2C Finance</h1>
        <p className="text-sm text-muted-foreground">
          {def.description} · {query.period.label} · gerado em {new Date().toLocaleDateString("pt-BR")}
        </p>
      </div>

      {pres.grafico && chartItems.length > 0 && (
        <div className="mb-5">
          <ChartCard title={`${moneyCol!.label} por ${pres.agrupar ? presented.columns.find((c) => c.key === pres.agrupar)?.label ?? "grupo" : labelCol?.label ?? ""}`}>
            <HBarList items={chartItems} />
          </ChartCard>
        </div>
      )}

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <ReportTable presented={presented} showTotals={pres.totais} />
        </CardContent>
      </Card>
    </div>
  );
}
