"use client";
import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { bulkUpdateClients, listEmployeeOptions } from "@/lib/actions/clients";

/**
 * Responsável em massa — escolhido da LISTA de colaboradores (25/09/2026).
 * Era um campo de texto livre: gravava só o nome, deixava o vínculo com o
 * colaborador apontando para outra pessoa e criava "responsáveis fantasma"
 * a cada erro de digitação. Carteira e Recebimentos usam este mesmo diálogo.
 */
export function BulkOwnerDialog({
  ids,
  onClose,
  onDone,
}: {
  ids: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [employees, setEmployees] = useState<{ id: string; name: string }[] | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    let ativo = true;
    listEmployeeOptions().then((l) => ativo && setEmployees(l)).catch(() => ativo && setEmployees([]));
    return () => {
      ativo = false;
    };
  }, []);

  function aplicar() {
    if (!value) {
      setError("Escolha o responsável (ou “Sem responsável”).");
      return;
    }
    start(async () => {
      setError(null);
      const r = await bulkUpdateClients({ ids, salesOwnerId: value === "__nenhum__" ? "" : value });
      if (r.ok) {
        onClose();
        onDone();
      } else setError(r.error ?? "Falha ao atualizar.");
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Alterar responsável em massa</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Aplicar a {ids.length} cliente{ids.length === 1 ? "" : "s"} selecionado{ids.length === 1 ? "" : "s"}.
        </p>
        <div className="py-1">
          <Label htmlFor="bulk-owner">Responsável</Label>
          <Select id="bulk-owner" value={value} onChange={(e) => setValue(e.target.value)} disabled={!employees}>
            <option value="">{employees ? "Selecione…" : "Carregando…"}</option>
            <option value="__nenhum__">— Sem responsável —</option>
            {(employees ?? []).map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </Select>
          {employees && employees.length === 0 && (
            <p className="mt-1 text-caption text-muted-foreground">
              Nenhum colaborador ativo. Cadastre na Folha para escolher aqui.
            </p>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={aplicar} disabled={pending}>{pending ? "Aplicando…" : "Aplicar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
