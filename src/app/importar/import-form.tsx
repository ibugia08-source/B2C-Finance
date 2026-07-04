"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
} from "@/lib/actions/import-pdf";
import { createBankAccountQuick } from "@/lib/actions/cards";
import { formatBRL, formatDateBR } from "@/lib/format";
import { FileUp, Sparkles, Plus } from "lucide-react";

/** {referenceMonth, referenceYear} → "YYYY-MM" (input type="month") */
function refToInput(
  ref: { referenceMonth: number; referenceYear: number } | null | undefined
) {
  if (!ref) return "";
  return `${ref.referenceYear}-${String(ref.referenceMonth).padStart(2, "0")}`;
}

function refLabel(value: string) {
  const m = value.match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[2]}/${m[1]}` : value;
}

export function ImportForm({ cards, accounts }: { cards: any[]; accounts: any[] }) {
  return (
    <Tabs defaultValue="pdf">
      <TabsList className="max-w-full overflow-x-auto">
        <TabsTrigger value="pdf">
          <Sparkles className="h-4 w-4 mr-1" /> Fatura PDF (automático)
        </TabsTrigger>
        <TabsTrigger value="csv">CSV / XLSX</TabsTrigger>
      </TabsList>

      <TabsContent value="pdf" className="pt-4">
        <PdfAutoPanel cards={cards} />
      </TabsContent>

      <TabsContent value="csv" className="pt-4">
        <CsvPanel cards={cards} accounts={accounts} />
      </TabsContent>
    </Tabs>
  );
}

function PdfAutoPanel({ cards }: { cards: any[] }) {
  const router = useRouter();
  const [localCards, setLocalCards] = useState<any[]>(cards);
  const [file, setFile] = useState<File | null>(null);
  const [cardId, setCardId] = useState("");
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<PdfPreviewResult | null>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function onAccountCreated(id: string, account: any) {
    setLocalCards((prev) =>
      prev.some((c) => c.id === id) ? prev : [...prev, account]
    );
    setCardId(id);
    router.refresh();
  }

  function buildFormData(withCard = true) {
    const fd = new FormData();
    if (file) fd.set("file", file);
    if (withCard && cardId) fd.set("cardId", cardId);
    if (reference) fd.set("reference", reference);
    return fd;
  }

  function analyze(selected: File | null) {
    if (!selected) return;
    start(async () => {
      const fd = new FormData();
      fd.set("file", selected);
      const r = await previewPdfImport(fd);
      setPreview(r);
      setResult(null);
      if (r.ok && r.suggestedCardId) setCardId(r.suggestedCardId);
      else setCardId("");
      if (r.ok) setReference(refToInput(r.suggestedReference));
    });
  }

  // Reanalisa com o cartão escolhido manualmente (atualiza duplicatas/categorias)
  function reanalyzeWithCard(id: string) {
    setCardId(id);
    if (!file || !id) return;
    start(async () => {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("cardId", id);
      const r = await previewPdfImport(fd);
      setPreview(r);
      if (r.ok && r.suggestedReference) setReference(refToInput(r.suggestedReference));
    });
  }

  const detectedLabel =
    preview && "detectedIssuer" in preview ? preview.detectedIssuer?.label : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Suba a fatura do seu cartão em <strong>PDF</strong>. O sistema lê o documento,
        identifica o banco automaticamente, vincula à conta bancária correspondente e lança
        todas as compras na fatura do mês — com data de fechamento, vencimento e total.
      </p>

      <div>
        <Label>Arquivo PDF da fatura</Label>
        <Input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            setPreview(null);
            setResult(null);
            analyze(f);
          }}
        />
      </div>

      {pending && !preview && (
        <p className="text-sm text-muted-foreground">Analisando documento…</p>
      )}

      {preview && preview.ok === false && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive space-y-1">
          <p className="font-medium">{preview.error}</p>
          {preview.reason && (
            <p className="text-xs text-foreground/70">
              Motivo técnico: <code>{preview.reason}</code>
            </p>
          )}
        </div>
      )}

      {preview && preview.ok && (
        <div className="space-y-4">
          {/* Detecção de banco/cartão */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">Banco detectado:</span>
              {detectedLabel ? (
                <Badge variant="success">{detectedLabel}</Badge>
              ) : (
                <Badge variant="warning">não identificado</Badge>
              )}
              <Badge variant="secondary">layout: {preview.layout}</Badge>
            </div>
            <div>
              <Label className="text-xs">Lançar na conta bancária</Label>
              <div className="flex gap-2">
                <Select
                  value={cardId}
                  onChange={(e) => reanalyzeWithCard(e.target.value)}
                  className="flex-1"
                >
                  <option value="">— selecione a conta —</option>
                  {localCards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.bank ? ` (${c.bank})` : ""}
                    </option>
                  ))}
                </Select>
                <NewBankAccountDialog onCreated={onAccountCreated} />
              </div>
              {preview.suggestedCardId ? (
                <p className="text-xs text-emerald-600 mt-1">
                  Conta sugerida automaticamente pelo banco da fatura.
                </p>
              ) : (
                <p className="text-xs text-amber-600 mt-1">
                  Não foi possível casar com uma conta automaticamente — selecione ou crie uma.
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Fatura de referência (mês)</Label>
              <Input
                type="month"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="max-w-[200px]"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Todas as compras do PDF entram nessa fatura — detectada pelo
                vencimento; ajuste se necessário.
              </p>
            </div>
          </div>

          {/* Resumo da fatura */}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">{preview.total} compras</Badge>
            {preview.duplicates > 0 && (
              <Badge variant="warning">{preview.duplicates} duplicatas</Badge>
            )}
            {preview.totalDetected != null && (
              <Badge variant="outline">
                total da fatura: {formatBRL(preview.totalDetected)}
              </Badge>
            )}
            {preview.closingDate && (
              <Badge variant="outline">fechamento: {formatDateBR(preview.closingDate)}</Badge>
            )}
            {preview.dueDate && (
              <Badge variant="outline">vencimento: {formatDateBR(preview.dueDate)}</Badge>
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
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{formatDateBR(r.date)}</TableCell>
                    <TableCell className="max-w-xs truncate">{r.description}</TableCell>
                    <TableCell className="text-right">{formatBRL(r.amount)}</TableCell>
                    <TableCell>
                      {r.installment && r.totalInstallments
                        ? `${r.installment}/${r.totalInstallments}`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {r.duplicate ? (
                        <Badge variant="warning">duplicata</Badge>
                      ) : r.historyMatched ? (
                        <Badge
                          variant="secondary"
                          title={`Reconhecida pelo histórico${
                            r.suggestedResponsibleName
                              ? ` → ${r.suggestedResponsibleName}`
                              : ""
                          }${r.suggestedCategoryName ? ` · ${r.suggestedCategoryName}` : ""}`}
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

          <Button
            type="button"
            disabled={!file || !cardId || pending}
            onClick={() =>
              start(async () => {
                const r = await commitPdfImport(buildFormData());
                if (r.ok) {
                  const refTxt = r.reference
                    ? ` ${refLabel(refToInput(r.reference))}`
                    : "";
                  setResult(
                    `✓ ${r.imported} compras lançadas na fatura${refTxt} · ${r.duplicates} duplicatas ignoradas · total ${r.total}`
                  );
                  setPreview(null);
                  setFile(null);
                  setCardId("");
                  setReference("");
                } else {
                  setResult(`Erro: ${r.error}`);
                }
              })
            }
          >
            <FileUp className="h-4 w-4 mr-1" />
            {cardId ? "Lançar na fatura" : "Selecione uma conta"}
          </Button>
        </div>
      )}

      {result && (
        <p className="text-sm rounded-md border bg-muted/40 px-3 py-2">{result}</p>
      )}
    </div>
  );
}

function CsvPanel({ cards, accounts }: { cards: any[]; accounts: any[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [cardId, setCardId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function buildFormData() {
    const fd = new FormData();
    if (file) fd.set("file", file);
    if (cardId) fd.set("cardId", cardId);
    if (accountId) fd.set("accountId", accountId);
    if (cardId && reference) fd.set("reference", reference);
    return fd;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div>
          <Label>Arquivo (CSV/XLSX)</Label>
          <Input
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div>
          <Label>Cartão de origem</Label>
          <Select value={cardId} onChange={(e) => setCardId(e.target.value)}>
            <option value="">— (não vincular)</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Conta de origem</Label>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— (não vincular)</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Fatura de referência</Label>
          <Input
            type="month"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={!cardId}
          />
          <p className="text-xs text-muted-foreground mt-1">
            Só para cartão. Vazio = detectar.
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
              const r = await commitImport(buildFormData());
              if (r.ok) {
                setResult(
                  `✓ ${r.imported} importadas · ${r.duplicates} duplicatas · ${r.ignored} ignoradas · total ${r.total}`
                );
                setPreview(null);
              } else {
                setResult(`Erro: ${r.error}`);
              }
            })
          }
        >
          Importar
        </Button>
      </div>

      {result && <p className="text-sm">{result}</p>}

      {preview?.ok === false && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {preview.error}
        </div>
      )}

      {preview?.ok && (
        <div>
          <p className="text-sm text-muted-foreground mb-2">
            {preview.total} lidas · {preview.valid} válidas · {preview.ignored} ignoradas · {preview.duplicates} duplicatas
          </p>
          <div className="border rounded max-h-96 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Parcela</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.slice(0, 200).map((r, i) => (
                  <TableRow key={i}>
                    <TableCell>{r.date ? formatDateBR(r.date) : "—"}</TableCell>
                    <TableCell className="max-w-xs truncate">{r.description || "—"}</TableCell>
                    <TableCell className="text-right">{formatBRL(r.amount)}</TableCell>
                    <TableCell>
                      {r.installment && r.totalInstallments ? `${r.installment}/${r.totalInstallments}` : "—"}
                    </TableCell>
                    <TableCell>
                      {r.reason ? (
                        <Badge variant="destructive" title={r.reason}>
                          ignorada
                        </Badge>
                      ) : r.duplicate ? (
                        <Badge variant="warning">duplicata</Badge>
                      ) : (
                        <Badge variant="success">ok</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}

function NewBankAccountDialog({
  onCreated,
}: {
  onCreated: (id: string, account: any) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" title="Nova conta bancária">
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova conta bancária</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              const { id } = await createBankAccountQuick(fd);
              onCreated(id, {
                id,
                name: String(fd.get("name") || ""),
                bank: String(fd.get("bank") || ""),
              });
              setOpen(false);
            })
          }
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          <div className="col-span-2">
            <Label>Nome</Label>
            <Input name="name" placeholder="Ex.: Inter Israel" required />
          </div>
          <div className="col-span-2">
            <Label>Banco</Label>
            <Input name="bank" placeholder="Ex.: Inter" />
          </div>
          <div>
            <Label>Limite total</Label>
            <Input name="limitTotal" defaultValue="0,00" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <Label>Fechamento</Label>
              <Input name="closingDay" type="number" min={1} max={31} defaultValue={1} />
            </div>
            <div>
              <Label>Vencimento</Label>
              <Input name="dueDay" type="number" min={1} max={31} defaultValue={10} />
            </div>
          </div>
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              Criar conta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
