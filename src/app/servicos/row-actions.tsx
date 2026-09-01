"use client";
import { showUndoToast } from "@/components/undo-toast";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { ServiceDialog } from "./service-dialog";
import { Pencil, Trash2 } from "lucide-react";
import { deleteService } from "@/lib/actions/services";
import { useTransition } from "react";

export function ServiceActions({ service }: { service: any }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 justify-end">
      <ServiceDialog
        initial={service}
        trigger={
          <Button variant="ghost" size="icon" aria-label="Editar serviço">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Excluir serviço"
        disabled={pending}
        onClick={async () => {
          if (!(await confirmAction({ title: `Excluir o serviço "${service.name}"?`, destructive: true }))) return;
          start(async () => {
            const res = await deleteService(service.id);
            if (!res.ok) showUndoToast({ message: String(res.error) });
          });
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
