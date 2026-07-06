"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  inspectContractTemplateFile,
  createContractTemplate,
} from "@/lib/actions/contract-templates";
import type { TemplateVariable } from "@/lib/docx/template";
import {
  COMMERCIAL_TYPE_LABEL,
  BILLING_MODEL_LABEL,
  DURATION_TYPE_LABEL,
} from "./_meta";
import { FilePlus2, Loader2, Sparkles, CheckCircle2, AlertTriangle, Braces } from "lucide-react";

/**
 * Novo modelo de contrato: envia o DOCX, mostra as variáveis {{ }}
 * encontradas (com alertas de nomes pouco claros) e salva com os
 * metadados comerciais.
 */
export function TemplateUploadDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<{
    variables: TemplateVariable[];
    warnings: string[];
  } | null>(null);
  const [pending, start] = useTransition();
  const [saving, startSaving] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setError(null);
    setAnalysis(null);
  }

  function analyze() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Selecione o modelo em .docx.");
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      setError(null);
      const res = await inspectContractTemplateFile(fd);
      if (res.ok) setAnalysis({ variables: res.variables, warnings: res.warnings });
      else setError(res.error);
    });
  }

  function save(fd: FormData) {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Selecione o modelo em .docx.");
      return;
    }
    fd.set("file", file);
    startSaving(async () => {
      setError(null);
      const res = await createContractTemplate(fd);
      if (res.ok) {
        setOpen(false);
        reset();
        if (res.id) router.push(`/contratos/${res.id}`);
      } else setError(res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <FilePlus2 className="h-4 w-4 mr-1" /> Novo modelo de contrato
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo modelo de contrato (.docx)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>Arquivo do modelo *</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".docx"
              onChange={reset}
              className="block w-full text-sm mt-1 file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-primary file:px-3 file:text-primary-foreground file:text-sm hover:file:brightness-110 border border-input rounded-md"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Use variáveis entre chaves duplas no texto, ex.: {"{{Nome da empresa}}"} ou {"{{nome_da_empresa}}"}.
            </p>
          </div>

          {!analysis && (
            <Button onClick={analyze} disabled={pending} className="w-full" variant="secondary">
              {pending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              {pending ? "Lendo o modelo…" : "Analisar variáveis do modelo"}
            </Button>
          )}

          {analysis && (
            <div className="rounded-lg border p-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                {analysis.variables.length} variável(is) identificada(s)
              </p>
              {analysis.variables.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {analysis.variables.map((v) => (
                    <span
                      key={v.rawName}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs"
                    >
                      <Braces className="h-3 w-3 text-primary" /> {v.label}
                    </span>
                  ))}
                </div>
              )}
              {analysis.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-600 flex gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w}
                </p>
              ))}
            </div>
          )}

          {analysis && (
            <form action={save} className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Nome do modelo *</Label>
                <Input name="name" required placeholder="ex.: MRR R$ 1.200 semestral" />
              </div>
              <div className="col-span-2">
                <Label>Descrição</Label>
                <Input name="description" placeholder="quando usar este modelo" />
              </div>
              <div>
                <Label>Tipo comercial</Label>
                <Select name="commercialType" defaultValue="">
                  <option value="">—</option>
                  {Object.entries(COMMERCIAL_TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Prazo</Label>
                <Select name="durationType" defaultValue="">
                  <option value="">—</option>
                  {Object.entries(DURATION_TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Valor mensal (R$)</Label>
                <Input name="monthlyAmount" inputMode="decimal" placeholder="1.200,00" />
              </div>
              <div>
                <Label>Valor total (R$)</Label>
                <Input name="totalAmount" inputMode="decimal" placeholder="5.700,00" />
              </div>
              <div>
                <Label>Duração (meses)</Label>
                <Input name="durationMonths" type="number" min={1} max={120} />
              </div>
              <div>
                <Label>Dia padrão de vencimento</Label>
                <Input name="defaultDueDay" type="number" min={1} max={28} placeholder="15" />
              </div>
              <div>
                <Label>Forma de pagamento</Label>
                <Select name="billingModel" defaultValue="">
                  <option value="">—</option>
                  {Object.entries(BILLING_MODEL_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select name="status" defaultValue="ACTIVE">
                  <option value="ACTIVE">Ativo</option>
                  <option value="DRAFT">Rascunho</option>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Serviços incluídos (separe por vírgula)</Label>
                <Input name="includedServices" placeholder="Tráfego pago, Social media, CRM" />
              </div>
              <div className="col-span-2">
                <Label>Observações internas</Label>
                <Textarea name="internalNotes" placeholder="notas para o time (não entram no contrato)" />
              </div>
              {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
              <DialogFooter className="col-span-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Salvando…" : "Salvar modelo"}
                </Button>
              </DialogFooter>
            </form>
          )}

          {error && !analysis && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
