import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/auth/viewer";
import { IMPORT_DEFS } from "@/lib/imports/definitions";
import { formatDateBR } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ImportClient } from "./import-client";
import { ReviewQueue } from "./review-queue";
import { filaDeRevisao } from "@/lib/services/import-review";

export default async function ImportacoesPage() {
  await requirePagePermission("importacoes.visualizar");

  const revisao = await filaDeRevisao();
  const history = await prisma.importBatch.findMany({
    where: { module: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  const titles = new Map(IMPORT_DEFS.map((d) => [d.key, d.title]));

  return (
    <div>
      <PageHeader
        title="Importação de dados"
        description="Baixe a planilha modelo, preencha e importe em massa — com validação e prévia antes de gravar"
      />

      <ImportClient
        defs={IMPORT_DEFS.map((d) => ({ key: d.key, title: d.title, description: d.description }))}
      />

      {/* F1.13 (v2): a carga histórica multi-mês tem assistente próprio —
          uma planilha com todos os meses constrói o passado inteiro. */}
      <Card className="mt-4">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-dense font-medium">Importação total (histórico multi-mês)</p>
            <p className="text-caption text-muted-foreground">
              Uma planilha com todos os meses: clientes, cobranças, pagamentos,
              avaliações e fotografias por competência — com prévia e reconciliação mês a mês.
            </p>
          </div>
          <Link
            href="/importacoes/total"
            className="inline-flex h-9 items-center rounded-input bg-brand px-3.5 text-sm font-medium text-brand-foreground"
          >
            Abrir assistente
          </Link>
        </CardContent>
      </Card>

      {/* Fila de revisão (03 §3.3): a linha duvidosa ENTRA, mas entra
          marcada. Recusá-la faria perder o trabalho de 300 linhas por causa
          de 4; deixar passar calada faria o dado duvidoso virar oficial. */}
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mt-8 mb-2">
        Linhas para conferir
        {revisao.length > 0 ? ` (${revisao.length})` : ""}
      </h2>
      <ReviewQueue itens={revisao} />

      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mt-8 mb-2">
        Histórico de importações
      </h2>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Módulo</TableHead>
                <TableHead>Arquivo</TableHead>
                <TableHead className="text-right">Linhas</TableHead>
                <TableHead className="text-right">Importadas</TableHead>
                <TableHead className="text-right">Duplicadas</TableHead>
                <TableHead className="text-right">Com erro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-10">
                    Nenhuma importação realizada ainda.
                  </TableCell>
                </TableRow>
              )}
              {history.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="text-sm">{formatDateBR(b.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{titles.get(b.module ?? "") ?? b.module}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{b.fileName ?? "—"}</TableCell>
                  <TableCell className="text-right">{b.total}</TableCell>
                  <TableCell className="text-right font-medium text-emerald-600">{b.imported}</TableCell>
                  <TableCell className="text-right text-amber-600">{b.duplicates}</TableCell>
                  <TableCell className="text-right text-red-600">{b.errors}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
