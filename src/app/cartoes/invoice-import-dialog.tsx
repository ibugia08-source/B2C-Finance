"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  previewImport,
  commitImport,
  type PreviewResult,
} from "@/lib/actions/import";
import {
  previewPdfImport,
  commitPdfImport,
  type PdfPreviewResult,
  type PdfPreviewRow,
} from "@/lib/actions/import-pdf";
import type { PdfDiagnostics } from "@/lib/pdf/parse-invoice-pdf";
import { formatBRL, formatDateBR } from "@/lib/format";
import { FileUp } from "lucide-react";

/** {referenceMonth, referenceYear} → "YYYY-MM" (input type="month") */
function refToInput(ref: { referenceMonth: number; referenceYear: number } | null | undefined) {
  if (!ref) return "";
  return `${ref.referenceYear}-${String(ref.referenceMonth).padStart(2, "0")}`;
}

function refLabel(value: string) {
  const m = value.match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : value;
}

export function InvoiceImportDialog({
  cardId,
  cardName,
  trigger,
}: {
  cardId: string;
  cardName: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setReference("");
    setPreview(null);
    setResult(null);
  }

  function buildFormData() {
    const fd = new FormData();
    if (file) fd.set("file", file);
    fd.set("cardId", cardId);
    if (reference) fd.set("reference", reference);
    return fd;
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <FileUp className="h-4 w-4 mr-1" /> Adicionar fatura / extrato
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Adicionar fatura / extrato — {cardName}</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="csv">
          <TabsList>
            <TabsTrigger value="csv">CSV / XLSX</TabsTrigger>
            <TabsTrigger value="pdf">PDF</TabsTrigger>
          </TabsList>

          <TabsContent value="csv" className="space-y-4 pt-4">
            <p className="text-sm text-muted-foreground">
              Suba o extrato mensal do cartão em CSV ou XLSX. Reconhecemos colunas
              comuns (data, descrição/title, valor) em português ou inglês. Transações
              serão vinculadas automaticamente a este cartão.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label>Arquivo CSV/XLSX do extrato</Label>
                <Input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPreview(null);
                    setResult(null);
                  }}
                />
              </div>
              <div>
                <Label>Fatura de referência (mês)</Label>
                <Input
                  type="month"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Todas as linhas entram nessa fatura. Vazio = detectar pelo arquivo.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!file || pending}
                onClick={() =>
                  start(async () => {
                    const r = await previewImport(buildFormData());
                    setPreview(r);
                    if (r.ok && !reference && r.suggestedReference) {
                      setReference(refToInput(r.suggestedReference));
                    }
                    setResult(null);
                  })
                }
              >
                Pré-visualizar
              </Button>
              <Button
                type="button"
                disabled={!file || pending}
                onClick={() =>
                  start(async () => {
                    if (!preview) {
                      // pré-visualiza primeiro
                      const p = await previewImport(buildFormData());
                      setPreview(p);
                      if (!p.ok || p.valid === 0) {
                        setResult(
                          p.ok
                            ? `Lemos ${p.total} linhas, mas nenhuma é válida. Veja o diagnóstico antes de confirmar.`
                            : `Erro: ${p.error}`
                        );
                        return;
                      }
                    } else if (preview.ok && preview.valid === 0) {
                      setResult("Nada para importar. Pré-visualize antes de confirmar.");
                      return;
                    }
                    const r = await commitImport(buildFormData());
                    if (r.ok) {
                      const refTxt = r.reference
                        ? ` na fatura ${refLabel(refToInput(r.reference))}`
                        : "";
                      setResult(
                        `✓ ${r.imported} importadas${refTxt} · ${r.duplicates} duplicatas · ${r.ignored} ignoradas · total ${r.total}`
                      );
                      setPreview(null);
                    } else {
                      setResult(`Erro: ${r.error}`);
                    }
                  })
                }
              >
                Confirmar importação
              </Button>
            </div>

            {result && (
              <p className="text-sm rounded-md border bg-muted/40 px-3 py-2">{result}</p>
            )}

            {preview?.ok === false && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {preview.error}
              </div>
            )}

            {preview?.ok && (
              <CsvDiagnostics preview={preview} />
            )}
          </TabsContent>

          <TabsContent value="pdf" className="pt-4">
            <PdfImportPanel cardId={cardId} cardName={cardName} />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PdfImportPanel({
  cardId,
  cardName,
}: {
  cardId: string;
  cardName: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<PdfPreviewResult | null>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function buildFormData() {
    const fd = new FormData();
    if (file) fd.set("file", file);
    fd.set("cardId", cardId);
    if (reference) fd.set("reference", reference);
    return fd;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Suba o extrato mensal de <strong>{cardName}</strong> em PDF. Tentamos múltiplos
        layouts (Nubank, Itaú e genérico). PDFs escaneados (imagem) não funcionam —
        exporte em CSV/XLSX nesses casos.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Arquivo PDF do extrato</Label>
          <Input
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setResult(null);
            }}
          />
        </div>
        <div>
          <Label>Fatura de referência (mês)</Label>
          <Input
            type="month"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Detectada pelo vencimento do PDF; ajuste se necessário.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!file || pending}
          onClick={() =>
            start(async () => {
              const r = await previewPdfImport(buildFormData());
              setPreview(r);
              if (r.ok && !reference && r.suggestedReference) {
                setReference(refToInput(r.suggestedReference));
              }
              setResult(null);
            })
          }
        >
          Pré-visualizar
        </Button>
        <Button
          type="button"
          disabled={!file || pending}
          onClick={() =>
            start(async () => {
              if (!preview) {
                const p = await previewPdfImport(buildFormData());
                setPreview(p);
                if (!p.ok || p.rows.length === 0) {
                  setResult(p.ok ? "Nada para importar." : `Erro: ${p.error}`);
                  return;
                }
                if (p.ok && !reference && p.suggestedReference) {
                  setReference(refToInput(p.suggestedReference));
                }
              } else if (!preview.ok || preview.rows.length === 0) {
                setResult("Pré-visualize um arquivo válido antes de confirmar.");
                return;
              }
              const r = await commitPdfImport(buildFormData());
              if (r.ok) {
                const refTxt = r.reference
                  ? ` na fatura ${refLabel(refToInput(r.reference))}`
                  : "";
                setResult(
                  `✓ ${r.imported} importadas${refTxt} · ${r.duplicates} duplicatas · total ${r.total}`
                );
                setPreview(null);
                setFile(null);
              } else {
                setResult(`Erro: ${r.error}`);
              }
            })
          }
        >
          Confirmar importação
        </Button>
      </div>

      {result && (
        <p className="text-sm rounded-md border bg-muted/40 px-3 py-2">{result}</p>
      )}

      {preview && preview.ok === false && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive space-y-2">
          <p className="font-medium">{preview.error}</p>
          {preview.reason && (
            <p className="text-xs text-foreground/70">
              Motivo técnico: <code>{preview.reason}</code>
            </p>
          )}
          {preview.diagnostics && (
            <PdfErrorDiagnostics diag={preview.diagnostics} />
          )}
          <p className="text-xs text-foreground/70">
            Sugestão: tentar exportar o extrato em CSV/XLSX ou baixar novamente o PDF
            pelo app/banco.
          </p>
        </div>
      )}

      {preview && preview.ok && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">layout: {preview.layout}</Badge>
            <Badge variant="outline">
              {preview.total} linhas · {preview.duplicates} duplicatas
            </Badge>
            {preview.totalDetected != null && (
              <Badge variant="outline">
                total extrato: {formatBRL(preview.totalDetected)}
              </Badge>
            )}
            <Badge variant="outline">
              diagnóstico: {preview.diagnostics.recognized}/{preview.diagnostics.totalLines} linhas
            </Badge>
            {preview.dueDate && (
              <Badge variant="outline">
                vencimento: {formatDateBR(preview.dueDate)}
              </Badge>
            )}
            {preview.closingDate && (
              <Badge variant="outline">
                fechamento: {formatDateBR(preview.closingDate)}
              </Badge>
            )}
            {preview.ignoredLines.length > 0 && (
              <Badge variant="warning">
                {preview.ignoredLines.length} linhas ignoradas
              </Badge>
            )}
          </div>

          <div className="border rounded max-h-80 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Categoria sug.</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r: PdfPreviewRow, i) => (
                  <TableRow key={`pdf-row-${i}`}>
                    <TableCell>{formatDateBR(r.date)}</TableCell>
                    <TableCell className="max-w-xs truncate">{r.description}</TableCell>
                    <TableCell className="text-right">{formatBRL(r.amount)}</TableCell>
                    <TableCell>
                      {r.installment && r.totalInstallments
                        ? `${r.installment}/${r.totalInstallments}`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {[r.suggestedCategoryName, r.suggestedResponsibleName]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </TableCell>
                    <TableCell>
                      {r.duplicate ? (
                        <Badge variant="warning">duplicata</Badge>
                      ) : r.historyMatched ? (
                        <Badge
                          variant="secondary"
                          title="Parcela reconhecida pelo histórico — herda pessoa/categoria da parcela anterior"
                        >
                          reconhecida
                        </Badge>
                      ) : (
                        <Badge variant="success">ok</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {preview.ignoredLines.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                Ver {preview.ignoredLines.length} linhas ignoradas
              </summary>
              <pre className="mt-2 max-h-40 overflow-auto bg-muted/50 p-2 rounded text-[11px] whitespace-pre-wrap">
                {preview.ignoredLines.join("\n")}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function CsvDiagnostics({ preview }: { preview: Extract<PreviewResult, { ok: true }> }) {
  const cols = preview.detectedColumns;
  const colChips = [
    { label: "data", value: cols.date },
    { label: "descrição", value: cols.description },
    { label: "valor", value: cols.amount },
    { label: "parcela", value: cols.installment },
    { label: "parcelas", value: cols.totalInstallments },
  ];
  const validRows = preview.rows.filter((r) => !r.reason);
  const rowsToShow = preview.rows.slice(0, 200);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">
          {preview.total} lidas · {preview.valid} válidas · {preview.ignored} ignoradas
        </Badge>
        <Badge variant="outline">{preview.duplicates} duplicatas</Badge>
        {colChips.map((c) =>
          c.value ? (
            <Badge key={c.label} variant="outline">
              {c.label}: <span className="font-mono ml-1">{c.value}</span>
            </Badge>
          ) : (
            <Badge key={c.label} variant="destructive">
              {c.label}: não encontrada
            </Badge>
          )
        )}
      </div>

      {validRows.length === 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Lemos {preview.total} linhas, mas nenhuma tinha data/descrição/valor reconhecíveis.
          Confira as colunas detectadas acima e o exemplo de linhas brutas abaixo.
        </div>
      )}

      <div className="border rounded max-h-80 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Parcela</TableHead>
              <TableHead>Categoria sug.</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rowsToShow.map((r, i) => (
              <TableRow key={`csv-row-${i}`}>
                <TableCell>{r.date ? formatDateBR(r.date) : "—"}</TableCell>
                <TableCell className="max-w-xs truncate">{r.description || "—"}</TableCell>
                <TableCell className="text-right">{formatBRL(r.amount)}</TableCell>
                <TableCell className="text-xs">
                  {r.isCredit ? (
                    <Badge variant="secondary">crédito/estorno</Badge>
                  ) : (
                    <Badge variant="outline">despesa</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {r.installment && r.totalInstallments
                    ? `${r.installment}/${r.totalInstallments}`
                    : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {[r.suggestedCategoryName, r.suggestedResponsibleName]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </TableCell>
                <TableCell>
                  {r.reason ? (
                    <Badge variant="destructive" title={r.reason}>
                      ignorada
                    </Badge>
                  ) : r.duplicate ? (
                    <Badge variant="warning">duplicata</Badge>
                  ) : r.historyMatched ? (
                    <Badge
                      variant="secondary"
                      title="Parcela reconhecida pelo histórico — herda pessoa/categoria da parcela anterior"
                    >
                      reconhecida
                    </Badge>
                  ) : (
                    <Badge variant="success">ok</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {preview.rawSample.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Ver exemplo de 3 linhas brutas lidas
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto bg-muted/50 p-2 rounded text-[11px] whitespace-pre-wrap">
            {JSON.stringify(preview.rawSample, null, 2)}
          </pre>
        </details>
      )}

      {preview.parsedSample.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Ver exemplo de 3 transações normalizadas
          </summary>
          <pre className="mt-2 max-h-40 overflow-auto bg-muted/50 p-2 rounded text-[11px] whitespace-pre-wrap">
            {JSON.stringify(
              preview.parsedSample.map((r) => ({
                date: r.date,
                description: r.description,
                amount: r.amount,
                isCredit: r.isCredit,
                installment: r.installment,
                totalInstallments: r.totalInstallments,
                reason: r.reason,
              })),
              null,
              2
            )}
          </pre>
        </details>
      )}

      {preview.ignoredReasons.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Ver motivos das {preview.ignored} linhas ignoradas
          </summary>
          <ul className="mt-2 max-h-40 overflow-auto bg-muted/50 p-2 rounded text-[11px] space-y-1">
            {preview.ignoredReasons.map((r) => (
              <li key={r.line}>
                <span className="font-mono">linha {r.line}:</span> {r.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function PdfErrorDiagnostics({ diag }: { diag: PdfDiagnostics }) {
  const sizeKb =
    diag.fileSize != null ? `${(diag.fileSize / 1024).toFixed(1)} KB` : "—";
  return (
    <details className="text-xs text-foreground/80">
      <summary className="cursor-pointer">
        Diagnóstico do arquivo
      </summary>
      <div className="mt-2 space-y-1.5 bg-background/60 p-3 rounded font-mono text-[11px]">
        <p>
          <span className="text-muted-foreground">arquivo:</span>{" "}
          {diag.fileName ?? "—"}
        </p>
        <p>
          <span className="text-muted-foreground">tamanho:</span> {sizeKb}
        </p>
        <p>
          <span className="text-muted-foreground">mime:</span>{" "}
          {diag.fileType || "—"}
        </p>
        <p>
          <span className="text-muted-foreground">cabeçalho %PDF:</span>{" "}
          {diag.startsWithPdfMagic ? "sim ✓" : "não ✗"}
        </p>
        <p>
          <span className="text-muted-foreground">primeiros bytes (hex):</span>{" "}
          {diag.firstBytesHex ?? "—"}
        </p>
        <p>
          <span className="text-muted-foreground">primeiros bytes (ascii):</span>{" "}
          {diag.firstBytesAscii ?? "—"}
        </p>
        <p>
          <span className="text-muted-foreground">layout:</span>{" "}
          {diag.layout}
        </p>
        <p>
          <span className="text-muted-foreground">linhas extraídas:</span>{" "}
          {diag.totalLines}
        </p>
        <p>
          <span className="text-muted-foreground">linhas reconhecidas:</span>{" "}
          {diag.recognized}
        </p>
        {diag.technicalError && (
          <p className="break-words">
            <span className="text-muted-foreground">erro técnico:</span>{" "}
            {diag.technicalError}
          </p>
        )}
        {diag.sampleLines.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-muted-foreground">
              Primeiras linhas extraídas
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">
              {diag.sampleLines.join("\n")}
            </pre>
          </details>
        )}
      </div>
    </details>
  );
}
