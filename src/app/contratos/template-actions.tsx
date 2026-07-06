"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  updateContractTemplate,
  setContractTemplateStatus,
  deleteContractTemplate,
} from "@/lib/actions/contract-templates";
import {
  COMMERCIAL_TYPE_LABEL,
  BILLING_MODEL_LABEL,
  DURATION_TYPE_LABEL,
} from "./_meta";
import { Pencil, Trash2, Archive, ArchiveRestore, Download, FileSignature } from "lucide-react";

export type TemplateLite = {
  id: string;
  name: string;
  description: string | null;
  commercialType: string | null;
  billingModel: string | null;
  durationType: string | null;
  durationMonths: number | null;
  monthlyAmount: number | null;
  totalAmount: number | null;
  defaultDueDay: number | null;
  includedServices: string[];
  internalNotes: string | null;
  status: string;
};

/** Editar nome/descrição/metadados do modelo (o arquivo não muda). */
export function TemplateEditDialog({ template }: { template: TemplateLite }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Editar nome e metadados">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar modelo — {template.name}</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await updateContractTemplate(fd);
            if (res.ok) setOpen(false); else setError(res.error);
          })}
          className="grid grid-cols-2 gap-3"
        >
          <input type="hidden" name="id" value={template.id} />
          <div className="col-span-2">
            <Label>Nome do modelo *</Label>
            <Input name="name" required defaultValue={template.name} />
          </div>
          <div className="col-span-2">
            <Label>Descrição</Label>
            <Input name="description" defaultValue={template.description ?? ""} />
          </div>
          <div>
            <Label>Tipo comercial</Label>
            <Select name="commercialType" defaultValue={template.commercialType ?? ""}>
              <option value="">—</option>
              {Object.entries(COMMERCIAL_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Prazo</Label>
            <Select name="durationType" defaultValue={template.durationType ?? ""}>
              <option value="">—</option>
              {Object.entries(DURATION_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Valor mensal (R$)</Label>
            <Input
              name="monthlyAmount"
              inputMode="decimal"
              defaultValue={template.monthlyAmount != null ? template.monthlyAmount.toFixed(2).replace(".", ",") : ""}
            />
          </div>
          <div>
            <Label>Valor total (R$)</Label>
            <Input
              name="totalAmount"
              inputMode="decimal"
              defaultValue={template.totalAmount != null ? template.totalAmount.toFixed(2).replace(".", ",") : ""}
            />
          </div>
          <div>
            <Label>Duração (meses)</Label>
            <Input name="durationMonths" type="number" min={1} max={120} defaultValue={template.durationMonths ?? ""} />
          </div>
          <div>
            <Label>Dia padrão de vencimento</Label>
            <Input name="defaultDueDay" type="number" min={1} max={28} defaultValue={template.defaultDueDay ?? ""} />
          </div>
          <div>
            <Label>Forma de pagamento</Label>
            <Select name="billingModel" defaultValue={template.billingModel ?? ""}>
              <option value="">—</option>
              {Object.entries(BILLING_MODEL_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select name="status" defaultValue={template.status}>
              <option value="ACTIVE">Ativo</option>
              <option value="DRAFT">Rascunho</option>
              <option value="ARCHIVED">Arquivado</option>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Serviços incluídos (vírgula)</Label>
            <Input name="includedServices" defaultValue={template.includedServices.join(", ")} />
          </div>
          <div className="col-span-2">
            <Label>Observações internas</Label>
            <Textarea name="internalNotes" defaultValue={template.internalNotes ?? ""} />
          </div>
          {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Ações da linha/card do modelo: gerar, baixar, editar, arquivar, excluir. */
export function TemplateActions({
  template,
  generateHref,
}: {
  template: TemplateLite;
  generateHref: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const archived = template.status === "ARCHIVED";

  return (
    <div className="flex items-center gap-0.5 justify-end">
      <Button size="sm" variant="outline" asChild className="mr-1">
        <Link href={generateHref} title="Gerar contrato a partir de Modelo">
          <FileSignature className="h-3.5 w-3.5 mr-1" /> Gerar contrato
        </Link>
      </Button>
      <Button size="icon" variant="ghost" asChild title="Baixar modelo original">
        <a href={`/api/arquivos/modelo/${template.id}`}>
          <Download className="h-4 w-4" />
        </a>
      </Button>
      <TemplateEditDialog template={template} />
      <Button
        size="icon"
        variant="ghost"
        title={archived ? "Reativar modelo" : "Arquivar modelo"}
        disabled={pending}
        onClick={() => start(async () => {
          const res = await setContractTemplateStatus(template.id, archived ? "ACTIVE" : "ARCHIVED");
          if (!res.ok) setError(res.error);
        })}
      >
        {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
      </Button>
      <Dialog open={confirming} onOpenChange={(o) => { setConfirming(o); if (!o) setError(null); }}>
        <DialogTrigger asChild>
          <Button size="icon" variant="ghost" title="Excluir modelo" className="text-destructive">
            <Trash2 className="h-4 w-4" />
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Excluir modelo?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            “{template.name}” será excluído da biblioteca. Modelos que já geraram
            contratos não podem ser excluídos — arquive-os.
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>Cancelar</Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => start(async () => {
                const res = await deleteContractTemplate(template.id);
                if (res.ok) setConfirming(false); else setError(res.error);
              })}
            >
              {pending ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
