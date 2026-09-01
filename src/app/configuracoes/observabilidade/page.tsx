import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { Activity } from "lucide-react";
import { requireAdmin } from "@/lib/auth/viewer";
import { resumoDeMedicoes } from "@/lib/observability";

/**
 * TEMPOS DO SISTEMA (T7 · ref. 03 §4.6, §4.7).
 *
 * p50/p95 por tela e ação, contra os orçamentos da spec. As amostras vivem
 * na memória do processo — reiniciou, recomeça — e a tela diz isso, porque
 * um gráfico que esconde a própria janela de medição mente por omissão.
 */
export const dynamic = "force-dynamic";

export default async function ObservabilidadePage() {
  await requireAdmin();
  const linhas = resumoDeMedicoes();

  return (
    <div>
      <PageHeader
        title="Tempos do sistema"
        description="Quanto cada tela e ação demora, contra o orçamento de experiência"
      />
      <p className="mb-4 text-dense text-muted-foreground">
        Medição do lado do servidor, desde o último reinício. O orçamento
        completo inclui rede e navegador — estourar aqui já garante o estouro
        lá, então o alerta é conservador no sentido certo.
      </p>

      {linhas.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="Sem medições ainda"
          description="Use o sistema — abrir as telas de trabalho e agir na fila alimenta esta página."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>O que</TableHead>
                  <TableHead className="text-right">Amostras</TableHead>
                  <TableHead className="text-right">p50</TableHead>
                  <TableHead className="text-right">p95</TableHead>
                  <TableHead className="text-right">Máx</TableHead>
                  <TableHead className="text-right">Orçamento</TableHead>
                  <TableHead>Situação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.chave}>
                    <TableCell className="font-mono text-dense">{l.chave}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.amostras}</TableCell>
                    <TableCell className="text-right tabular-nums">{l.p50} ms</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{l.p95} ms</TableCell>
                    <TableCell className="text-right tabular-nums">{l.max} ms</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.orcamentoMs != null ? `${l.orcamentoMs} ms` : "—"}
                    </TableCell>
                    <TableCell>
                      {l.orcamentoMs == null ? (
                        <Badge variant="outline">sem orçamento</Badge>
                      ) : l.estourado ? (
                        <Badge variant="destructive">Estourado</Badge>
                      ) : l.amostras < 20 ? (
                        <Badge variant="outline">amostra pequena</Badge>
                      ) : (
                        <Badge variant="success">Dentro</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
