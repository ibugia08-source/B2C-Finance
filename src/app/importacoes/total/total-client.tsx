"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  runImportTotal, reverterImportTotalAction, type ImportTotalResult,
} from "@/lib/actions/import-total";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { formatBRL } from "@/lib/format";
import { Download, FileUp, CheckCircle2, AlertTriangle, Loader2, Undo2 } from "lucide-react";

export function ImportTotalClient() {
  const [result, setResult] = useState<ImportTotalResult | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function submit(confirm: boolean) {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setResult({ ok: false, error: "Selecione a planilha preenchida (.xlsx)." });
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    if (confirm) fd.set("confirm", "1");
    start(async () => {
      const res = await runImportTotal(fd);
      setResult(res);
      if (res.ok && res.confirmado) router.refresh();
    });
  }

  const ok = result?.ok ? result : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_auto]">
            <div>
              <Label htmlFor="planilha-total">Planilha (.xlsx) — abas CLIENTES, MENSAL e RENOVACOES</Label>
              <input
                id="planilha-total"
                ref={fileRef}
                type="file"
                accept=".xlsx"
                onChange={() => setResult(null)}
                className="mt-1 block w-full text-dense file:mr-3 file:rounded file:border-0 file:bg-surface-sunken file:px-2.5 file:py-1 file:text-dense"
              />
            </div>
            <a
              href="/importacoes/total/modelo"
              className="inline-flex h-9 items-center gap-1.5 rounded-input border border-border px-3.5 text-sm font-medium hover:bg-surface-raised"
            >
              <Download className="h-4 w-4" aria-hidden /> Baixar modelo
            </a>
            <Button onClick={() => submit(false)} disabled={pending}>
              {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <FileUp className="mr-1.5 h-4 w-4" aria-hidden />}
              Ver prévia
            </Button>
          </div>
          <p className="mt-2 text-caption text-muted-foreground">
            Nada é gravado na prévia. Formato largo (uma aba por mês, ou colunas
            de meses) é convertido automaticamente.
          </p>
        </CardContent>
      </Card>

      {result && !result.ok && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 p-4 text-dense text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {result.error}
          </CardContent>
        </Card>
      )}

      {ok && (
        <>
          {/* Contagens da prévia */}
          <Card>
            <CardContent className="grid grid-cols-2 gap-x-6 gap-y-2 p-4 text-dense lg:grid-cols-5">
              <Campo rotulo="Arquivo" valor={ok.fileName} />
              <Campo rotulo="Formato" valor={ok.formato === "longo" ? "3 abas (canônico)" : "largo (convertido)"} />
              <Campo rotulo="Clientes" valor={String(ok.contagens.clientes)} />
              <Campo rotulo="Linhas mensais" valor={String(ok.contagens.mensal)} />
              <Campo rotulo="Competências" valor={String(ok.contagens.competencias)} />
            </CardContent>
          </Card>

          {ok.erros.length > 0 && (
            <Card className="border-destructive/40">
              <CardContent className="p-4">
                <p className="mb-2 text-dense font-medium text-destructive">
                  {ok.erros.length} erro(s) de linha — corrija na planilha e envie de novo:
                </p>
                <ul className="max-h-56 space-y-1 overflow-y-auto text-caption">
                  {ok.erros.map((e, i) => (
                    <li key={i}>
                      <span className="font-medium">{e.aba}</span> linha {e.linha} · {e.campo}: {e.erro}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {ok.avisos.length > 0 && (
            <Card className="border-warning/40">
              <CardContent className="p-4">
                <p className="mb-2 text-dense font-medium text-warning-foreground">Avisos</p>
                <ul className="max-h-40 space-y-1 overflow-y-auto text-caption text-muted-foreground">
                  {ok.avisos.map((a, i) => (<li key={i}>{a}</li>))}
                </ul>
              </CardContent>
            </Card>
          )}

          {ok.revisoes.length > 0 && (
            <Card>
              <CardContent className="p-4">
                <p className="mb-2 text-dense font-medium">
                  {ok.revisoes.length} linha(s) vão pedir conferência humana (entram marcadas, nada é recusado):
                </p>
                <ul className="max-h-56 space-y-1 overflow-y-auto text-caption text-muted-foreground">
                  {ok.revisoes.map((r, i) => (
                    <li key={i}>
                      <span className="font-medium">{r.aba}</span> linha {r.linha}: {r.motivo}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* RELATÓRIO DE RECONCILIAÇÃO POR MÊS — conferir contra a planilha */}
          {ok.reconciliacao.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <p className="px-4 pt-4 text-dense font-medium">
                  Reconciliação por mês — confira com a sua planilha antes de confirmar
                </p>
                <p className="px-4 pb-2 pt-1 text-caption text-muted-foreground">
                  “Recuperado” é o que foi pago em outro mês (entra no caixa de lá;
                  aqui o mês fica vencido, como aconteceu de verdade).
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mês</TableHead>
                        <TableHead className="text-right">Ativos</TableHead>
                        <TableHead className="text-right">Esperado</TableHead>
                        <TableHead className="text-right">Recebido</TableHead>
                        <TableHead className="text-right">Recuperado</TableHead>
                        <TableHead className="text-right">Vencido</TableHead>
                        <TableHead className="text-right">Críticos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ok.reconciliacao.map((m) => (
                        <TableRow key={m.competencia}>
                          <TableCell className="font-medium">{m.competencia}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.ativos}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBRL(m.esperado)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBRL(m.recebido)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBRL(m.recuperado)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatBRL(m.vencido)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {m.criticos}
                            {m.semValor > 0 ? ` · ${m.semValor} sem valor` : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {!ok.confirmado && ok.erros.length === 0 && ok.contagens.mensal + ok.contagens.clientes > 0 && (
            <div className="flex items-center gap-3">
              <Button onClick={() => submit(true)} disabled={pending}>
                {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
                Confirmar importação
              </Button>
              <span className="text-caption text-muted-foreground">
                Grava tudo acima e gera as fotografias dos meses encerrados.
              </span>
            </div>
          )}

          {ok.confirmado && (
            <Card className="border-success/40">
              <CardContent className="p-4">
                <p className="mb-2 flex items-center gap-2 text-dense font-medium text-success">
                  <CheckCircle2 className="h-4 w-4" aria-hidden /> Importação concluída
                </p>
                <ul className="space-y-1 text-dense">
                  <li>{ok.confirmado.clientesCriados} cliente(s) criado(s) · {ok.confirmado.clientesAtualizados} atualizado(s)</li>
                  <li>{ok.confirmado.cobrancasCriadas} cobrança(s) · {ok.confirmado.pagamentosCriados} pagamento(s) · {ok.confirmado.avaliacoesGravadas} avaliação(ões)</li>
                  <li>{ok.confirmado.termosAbertos} termo(s) comercial(is) aberto(s)</li>
                  <li>
                    Fotografias: {ok.confirmado.fotografias.geradas.map((g) => g.competencia).join(", ") || "nenhuma"}
                    {ok.confirmado.fotografias.puladas.length > 0
                      ? ` · puladas: ${ok.confirmado.fotografias.puladas.map((p) => `${p.competencia} (${p.motivo})`).join("; ")}`
                      : ""}
                  </li>
                  {ok.confirmado.paraRevisar > 0 && (
                    <li className="text-warning-foreground">
                      {ok.confirmado.paraRevisar} linha(s) na fila de conferência.
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{rotulo}</dt>
      <dd className="truncate font-medium">{valor}</dd>
    </div>
  );
}

export function ReverterLote({ batchId, arquivo }: { batchId: string; arquivo: string }) {
  const [erro, setErro] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={async () => {
          const sim = await confirmAction({
            title: "Reverter este lote?",
            description: `Desfaz tudo o que o lote "${arquivo}" criou — pagamentos são estornados pelo motor. O que ele apenas atualizou não é tocado.`,
            confirmLabel: "Reverter o lote",
            destructive: true,
          });
          if (!sim) return;
          start(async () => {
            const r = await reverterImportTotalAction(batchId);
            if (r.ok) { setErro(null); router.refresh(); }
            else setErro(r.error);
          });
        }}
      >
        <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden /> {pending ? "Revertendo…" : "Reverter"}
      </Button>
      {erro && <p className="mt-1 text-caption text-destructive">{erro}</p>}
    </>
  );
}
