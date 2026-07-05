import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { prisma } from "@/lib/prisma";
import { formatBRL, formatDateBR } from "@/lib/format";
import { getBalanceSummary } from "@/lib/services/finance-metrics";
import { markOverdueBillings } from "@/lib/services/billing-metrics";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/viewer";
import { AssetDialog, AssetActions } from "./asset-dialog";
import { ASSET_TYPE_LABEL } from "./_meta";

export default async function AtivosPage() {
  await requireAdmin();
  await markOverdueBillings();

  const [balance, assetsRaw] = await Promise.all([
    getBalanceSummary(),
    prisma.asset.findMany({ orderBy: [{ type: "asc" }, { name: "asc" }] }),
  ]);
  const assets = assetsRaw.map((a) => ({ ...a, value: Number(a.value) }));

  return (
    <div>
      <PageHeader
        title="Ativos"
        description="O que a agência tem"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link href="/passivos">Passivos →</Link></Button>
            <AssetDialog />
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        <StatCard title="Saldo em contas" value={formatBRL(balance.contas)} />
        <StatCard title="Reservas (caixinhas)" value={formatBRL(balance.reservas)} />
        <StatCard title="A receber (cobranças)" value={formatBRL(balance.aReceber)} />
        <StatCard title="Ativos cadastrados" value={formatBRL(balance.ativosManuais)} />
        <StatCard title="ATIVOS TOTAIS" value={formatBRL(balance.ativosTotais)} intent="positive" />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ativo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Aquisição</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                    Nenhum ativo cadastrado. Contas, reservas e valores a receber
                    já entram automaticamente — cadastre aqui equipamentos,
                    investimentos e créditos.
                  </TableCell>
                </TableRow>
              )}
              {assets.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell>{ASSET_TYPE_LABEL[a.type] ?? a.type}</TableCell>
                  <TableCell>{a.acquiredAt ? formatDateBR(a.acquiredAt) : "—"}</TableCell>
                  <TableCell className="text-right">{formatBRL(a.value)}</TableCell>
                  <TableCell className="text-right"><AssetActions asset={a} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
