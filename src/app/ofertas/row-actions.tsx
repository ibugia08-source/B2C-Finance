"use client";
import { Button } from "@/components/ui/button";
import { OfferDialog } from "./offer-dialog";
import { Pencil, Trash2, Power } from "lucide-react";
import { deleteOffer, toggleOfferActive } from "@/lib/actions/offers";
import { useTransition } from "react";

export function OfferActions({
  offer,
  services,
}: {
  offer: any;
  services: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 justify-end">
      <OfferDialog
        services={services}
        initial={offer}
        trigger={
          <Button variant="ghost" size="icon" title="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        title={offer.active ? "Desativar" : "Ativar"}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await toggleOfferActive(offer.id);
            if (!res.ok) alert(res.error);
          })
        }
      >
        <Power className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title="Excluir"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Excluir a oferta "${offer.name}"?`)) return;
          start(async () => {
            const res = await deleteOffer(offer.id);
            if (!res.ok) alert(res.error);
          });
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
