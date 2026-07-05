"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { runImport, type ImportResult } from "@/lib/actions/imports";
import { Download, FileUp, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

type DefMeta = { key: string; title: string; description: string };

export function ImportClient({ defs }: { defs: DefMeta[] }) {
  const [tipo, setTipo] = useState(defs[0]?.key ?? "");
  const [result, setResult] = useState<ImportResult | null>(null);
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
    fd.set("tipo", tipo);
    fd.set("file", file);
    if (confirm) fd.set("confirm", "1");
    start(async () => {
      const res = await runImport(fd);
      setResult(res);
      if (res.ok && res.confirmed) router.refresh();
    });
  }

  const def = defs.find((d) => d.key === tipo);
  const ok = result?.ok ? result : null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-[220px_1fr_auto_auto] gap-3 items-end">
            <div>
              <Label>Tipo de importação</Label>
              <Select
                value={tipo}
                onChange={(e) => { setTipo(e.target.value); setResult(null); if (fileRef.current) fileRef.current.value = ""; }}
              >
                {defs.map((d) => (
                  <option key={d.key} value={d.key}>{d.title}</option>
                ))}
              </Select>
              {def && <p className="text-xs text-muted-foreground mt-1">{def.description}</p>}
            </div>
            <div>
              <Label>Planilha preenchida (.xlsx)</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={() => setResult(null)}
                className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border-0 file:bg-primary file:px-4 file:text-primary-foreground file:text-sm file:font-medium hover:file:brightness-110 border border-input rounded-md"
              />
            </div>
            <Button variant="outline" asChild>
              <a href={`/importacoes/template?tipo=${tipo}`}>
                <Download className="h-4 w-4 mr-1" /> Baixar modelo
              </a>
            </Button>
            <Button onClick={() => submit(false)} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileUp className="h-4 w-4 mr-1" />}
              Validar planilha
            </Button>
          </div>
        </CardContent>
      </Card>

      {result && !result.ok && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 text-sm text-destructive flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {result.error}
          </CardContent>
        </Card>
      )}

      {ok && (
        <>
          {/* Resumo da validação */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <SummaryCard label="Total de linhas" value={ok.total} />
            <SummaryCard label="Linhas válidas" value={ok.validas} tone={ok.validas > 0 ? "good" : undefined} />
            <SummaryCard label="Linhas com erro" value={ok.comErro} tone={ok.comErro > 0 ? "bad" : undefined} />
            <SummaryCard label="Duplicadas (puladas)" value={ok.duplicadas} tone={ok.duplicadas > 0 ? "warn" : undefined} />
          </div>

          {ok.headerErrors.length > 0 && (
            <Card className="border-destructive/50">
              <CardContent className="p-4 space-y-1">
                {ok.headerErrors.map((e, i) => (
                  <p key={i} className="text-sm text-destructive">• {e}</p>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Erros por linha */}
          {ok.erros.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <p className="px-4 pt-4 text-sm font-medium text-destructive">
                  Erros por linha ({ok.erros.length}{ok.erros.length === 100 ? "+" : ""}) — corrija na planilha e valide de novo
                </p>
                <div className="max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Linha</TableHead>
                        <TableHead>Campo</TableHead>
                        <TableHead>Erro</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ok.erros.map((e, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{e.linha}</TableCell>
                          <TableCell className="text-sm">{e.campo}</TableCell>
                          <TableCell className="text-sm text-destructive">{e.erro}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Prévia + confirmação */}
          {ok.validas > 0 && !ok.confirmed && (
            <Card>
              <CardContent className="p-0">
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
                  <p className="text-sm font-medium">
                    Prévia — {Math.min(10, ok.validas)} de {ok.validas} linha(s) que serão criadas
                  </p>
                  <Button onClick={() => submit(true)} disabled={pending}>
                    {pending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                    Confirmar importação ({ok.validas})
                  </Button>
                </div>
                <p className="px-4 pb-2 text-xs text-muted-foreground">
                  Nada foi gravado ainda. Duplicadas são puladas — registros existentes nunca são sobrescritos.
                </p>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {ok.preview.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ok.preview.rows.map((r, i) => (
                        <TableRow key={i}>
                          {r.map((c, j) => <TableCell key={j} className="text-sm whitespace-nowrap">{c}</TableCell>)}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {ok.confirmed && (
            <Card className="border-emerald-500/50">
              <CardContent className="p-4 flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                <span>
                  <strong>{ok.confirmed.imported}</strong> registro(s) importado(s) com sucesso
                  {ok.duplicadas > 0 && <> · {ok.duplicadas} duplicada(s) pulada(s)</>}
                  {ok.comErro > 0 && <> · {ok.comErro} com erro (não importadas)</>}
                  . Lote registrado para auditoria.
                </span>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" | "warn" }) {
  const color =
    tone === "good" ? "text-emerald-600" : tone === "bad" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
