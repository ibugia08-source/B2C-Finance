"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { UpsellDialog } from "./upsell-dialog";
import { Pencil, Trash2, BadgeCheck } from "lucide-react";
import { deleteUpsell, setUpsellStatus } from "@/lib/actions/upsells";
import { formatBRL } from "@/lib/format";

type Opt = { id: string; name: string };

export function UpsellActions({
  upsell,
  clients,
  services,
  offers,
}: {
  upsell: any;
  clients: Opt[];
  services: Opt[];
  offers: Opt[];
}) {
  const [pending, start] = useTransition();
  const [sellOpen, setSellOpen] = useState(false);
  const isOpen = upsell.status === "OPPORTUNITY" || upsell.status === "NEGOTIATION";

  return (
    <div className="flex gap-1 justify-end items-center">
      {isOpen && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-500/30"
          onClick={() => setSellOpen(true)}
        >
          <BadgeCheck className="h-3.5 w-3.5 mr-1" /> Vendido
        </Button>
      )}
      <UpsellDialog
        clients={clients}
        services={services}
        offers={offers}
        initial={upsell}
        trigger={
          <Button variant="ghost" size="icon" title="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        title="Excluir"
        disabled={pending}
        onClick={() => {
          if (!confirm("Excluir esta oportunidade de upsell?")) return;
          start(async () => {
            const res = await deleteUpsell(upsell.id);
            if (!res.ok) alert(res.error);
          });
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>

      {sellOpen && (
        <MarkSoldDialog upsell={upsell} onClose={() => setSellOpen(false)} />
      )}
    </div>
  );
}

/** Confirma a venda e permite gerar a receita associada ao cliente. */
function MarkSoldDialog({ upsell, onClose }: { upsell: any; onClose: () => void }) {
  const [generateIncome, setGenerateIncome] = useState(true);
  const [pending, start] = useTransition();

  function confirmSale() {
    start(async () => {
      const res = await setUpsellStatus(upsell.id, "WON", { generateIncome });
      if (!res.ok) alert(res.error);
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar upsell como vendido</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{upsell.clientName}</span> —{" "}
          {upsell.title ?? upsell.targetName ?? "venda interna"} ·{" "}
          <span className="font-medium text-foreground">{formatBRL(Number(upsell.value))}</span>
        </p>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox
            checked={generateIncome}
            onChange={() => setGenerateIncome((v) => !v)}
          />
          Gerar receita associada ao cliente (entra no faturamento recebido)
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={confirmSale} disabled={pending}>
            {pending ? "Salvando…" : "Confirmar venda"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
