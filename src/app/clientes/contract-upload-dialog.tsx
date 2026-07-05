"use client";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { extractClientFromContract, type ContractExtraction } from "@/lib/actions/clients";
import { ClientDialog } from "./client-dialog";
import { FileText, Loader2, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * Novo cliente por contrato: envia o PDF, a IA extrai os dados e o
 * formulário de cliente abre pré-preenchido — só falta completar o que
 * o contrato não trouxe.
 */
export function ContractUploadDialog() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ContractExtraction | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  function analyze() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setResult({ ok: false, error: "Selecione o contrato em PDF." });
      return;
    }
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      setResult(await extractClientFromContract(fd));
    });
  }

  const ok = result?.ok ? result : null;
  const extractedLabels: [string, string][] = ok
    ? [
        ["Nome", ok.data.name],
        ["CNPJ/CPF", ok.data.document],
        ["E-mail", ok.data.email],
        ["Telefone", ok.data.phone],
        ["Modelo", ok.data.paymentModel],
        ["Valor total", ok.data.contractTotal ? `R$ ${ok.data.contractTotal}` : ""],
        ["Prazo", ok.data.contractMonths ? `${ok.data.contractMonths} mês(es)` : ""],
        ["Dia de pagamento", ok.data.paymentDay],
      ].filter(([, v]) => v) as [string, string][]
    : [];

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setResult(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileText className="h-4 w-4 mr-1" /> Novo cliente por contrato
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo cliente por contrato (PDF)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Contrato assinado (.pdf)</Label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              onChange={() => setResult(null)}
              className="block w-full text-sm mt-1 file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-primary file:px-3 file:text-primary-foreground file:text-sm hover:file:brightness-110 border border-input rounded-md"
            />
            <p className="text-xs text-muted-foreground mt-1">
              A IA lê o contrato e preenche o cadastro — você só completa o que faltar.
            </p>
          </div>

          <Button onClick={analyze} disabled={pending} className="w-full">
            {pending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            {pending ? "Lendo contrato…" : "Ler contrato com IA"}
          </Button>

          {result && !result.ok && (
            <p className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {result.error}
            </p>
          )}

          {ok && (
            <div className="rounded-lg border p-3 space-y-3">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Dados encontrados no contrato
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {extractedLabels.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="font-medium truncate">{v}</dd>
                  </div>
                ))}
              </dl>
              {ok.missing.length > 0 && (
                <p className="text-xs text-amber-600">
                  Complete no cadastro: {ok.missing.join(", ")}.
                </p>
              )}
              <DialogFooter>
                <ClientDialog
                  initial={{
                    ...ok.data,
                    monthlyValue: null,
                    startedAt: null,
                  }}
                  trigger={
                    <Button className="w-full">
                      Continuar cadastro pré-preenchido
                    </Button>
                  }
                />
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
