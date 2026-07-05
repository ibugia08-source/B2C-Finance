"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveAsset, deleteAsset } from "@/lib/actions/assets";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { formatDateInput } from "@/lib/format";

import { ASSET_TYPE_LABEL } from "./_meta";

export function AssetDialog({ initial, trigger }: { initial?: any; trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(null); }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button><Plus className="h-4 w-4 mr-1" /> Novo ativo</Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{initial ? "Editar ativo" : "Novo ativo"}</DialogTitle></DialogHeader>
        <form
          action={(fd) => start(async () => {
            setError(null);
            const res = await saveAsset(fd);
            if (res.ok) setOpen(false); else setError(res.error);
          })}
          className="grid grid-cols-2 gap-3"
        >
          {initial?.id && <input type="hidden" name="id" value={initial.id} />}
          <div className="col-span-2">
            <Label>Nome *</Label>
            <Input name="name" defaultValue={initial?.name ?? ""} required />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select name="type" defaultValue={initial?.type ?? "OTHER"}>
              {Object.entries(ASSET_TYPE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Valor (R$) *</Label>
            <Input name="value" inputMode="decimal" required placeholder="0,00"
              defaultValue={initial?.value != null ? Number(initial.value).toFixed(2).replace(".", ",") : ""} />
          </div>
          <div className="col-span-2">
            <Label>Data de aquisição</Label>
            <Input type="date" name="acquiredAt"
              defaultValue={initial?.acquiredAt ? formatDateInput(initial.acquiredAt) : ""} />
          </div>
          <div className="col-span-2">
            <Label>Observações</Label>
            <Textarea name="notes" defaultValue={initial?.notes ?? ""} />
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

export function AssetActions({ asset }: { asset: any }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 justify-end">
      <AssetDialog initial={asset} trigger={
        <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
      } />
      <Button variant="ghost" size="icon" disabled={pending}
        onClick={() => {
          if (!confirm(`Excluir o ativo "${asset.name}"?`)) return;
          start(async () => {
            const res = await deleteAsset(asset.id);
            if (!res.ok) alert(res.error);
          });
        }}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
