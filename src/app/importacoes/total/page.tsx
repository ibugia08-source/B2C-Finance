import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { prisma } from "@/lib/prisma";
import { requirePagePermission } from "@/lib/auth/viewer";
import { formatDateBR } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ImportTotalClient, ReverterLote } from "./total-client";

/**
 * IMPORTAÇÃO TOTAL (F1.13 v2) — carga histórica multi-mês.
 * Uma planilha com todos os meses alimenta o sistema inteiro por
 * competência; a máquina do tempo responde "como estava agosto" logo depois.
 */
export default async function ImportacaoTotalPage() {
  await requirePagePermission("importacoes.visualizar");

  const lotes = await prisma.importBatch.findMany({
    where: { module: "total" },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return (
    <div>
      <PageHeader
        title="Importação total"
        description="A planilha com todos os meses constrói o passado: clientes, cobranças, pagamentos, avaliações e fotografias por competência"
      />

      <ImportTotalClient />

      <h2 className="mt-8 mb-2 text-sm font-medium uppercase tracking-wide text-muted-foreground">
        Lotes de importação total
      </h2>
      <Card>
        <CardContent className="p-0">
          {lotes.length === 0 ? (
            <p className="px-4 py-6 text-dense text-muted-foreground">
              Nenhum lote ainda. Baixe o modelo acima, preencha e importe — nada
              é gravado antes da prévia ser confirmada.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead className="text-right">Linhas</TableHead>
                    <TableHead className="text-right">Gravadas</TableHead>
                    <TableHead className="text-right">Para revisar</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lotes.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>{formatDateBR(l.createdAt)}</TableCell>
                      <TableCell className="max-w-[280px] truncate">{l.fileName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.total}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.imported}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.errors}</TableCell>
                      <TableCell className="text-right">
                        {l.fileName?.includes("[REVERTIDO]") ? (
                          <span className="text-caption text-muted-foreground">revertido</span>
                        ) : (
                          <ReverterLote batchId={l.id} arquivo={l.fileName ?? l.id} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-4 text-caption text-muted-foreground">
        As linhas que pedirem conferência humana aparecem em{" "}
        <Link href="/importacoes" className="underline underline-offset-2">
          Importação de dados → Linhas para conferir
        </Link>
        .
      </p>
    </div>
  );
}
