"use client";
import { Button } from "@/components/ui/button";
import { ClientDialog } from "./client-dialog";
import { ClientLossDialog } from "./loss-dialog";
import { Pencil, Trash2, Eye, UserX } from "lucide-react";
import { deleteClient } from "@/lib/actions/clients";
import { useTransition } from "react";
import Link from "next/link";

export function ClientActions({
  client,

}: {
  client: any;
}) {
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 justify-end">
      <Button variant="ghost" size="icon" asChild title="Ver detalhes">
        <Link href={`/clientes/${client.id}`}>
          <Eye className="h-4 w-4" />
        </Link>
      </Button>
      <ClientDialog
        initial={client}
        trigger={
          <Button variant="ghost" size="icon" title="Editar">
            <Pencil className="h-4 w-4" />
          </Button>
        }
      />
      {client.status !== "CHURNED" && (
        <ClientLossDialog
          clientId={client.id}
          clientName={client.name}
          trigger={
            <Button variant="ghost" size="icon" title="Perda de cliente">
              <UserX className="h-4 w-4 text-destructive" />
            </Button>
          }
        />
      )}
      <Button
        variant="ghost"
        size="icon"
        title="Excluir"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Excluir o cliente "${client.name}"?`)) return;
          start(async () => {
            const res = await deleteClient(client.id);
            if (!res.ok) alert(res.error);
          });
        }}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}
