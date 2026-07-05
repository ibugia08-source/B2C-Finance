"use client";
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
          <Button variant="ghost" size="icon">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      <Button
        variant="ghost"
        size="icon"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Excluir o serviço "${service.name}"?`)) return;
          start(async () => {
            const res = await deleteService(service.id);
            if (!res.ok) alert(res.error);
          });
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
