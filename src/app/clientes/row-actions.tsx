"use client";
import { Button } from "@/components/ui/button";
import { ClientDialog } from "./client-dialog";
import { ClientLossDialog } from "./loss-dialog";
import { MoreVertical, DollarSign, Eye, Pencil, Trash2, UserX } from "lucide-react";
import { deleteClient } from "@/lib/actions/clients";
import { useTransition, useState } from "react";
import Link from "next/link";

export function ClientActions({
  client,
}: {
  client: any;
}) {
  const [pending, start] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex gap-2 justify-end items-center">
      {/* Registrar Pagamento - Primary Action */}
      <Button
        variant="default"
        size="sm"
        asChild
        className="text-xs"
      >
        <Link href={`/cobrancas?cliente=${encodeURIComponent(client.id)}`}>
          <DollarSign className="h-4 w-4 mr-1" />
          Pagamento
        </Link>
      </Button>

      {/* Ver Detalhes - Primary Action */}
      <Button
        variant="outline"
        size="sm"
        asChild
        className="text-xs"
      >
        <Link href={`/clientes/${client.id}`}>
          <Eye className="h-4 w-4 mr-1" />
          Detalhes
        </Link>
      </Button>

      {/* More Actions Dropdown */}
      <div className="relative">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMenuOpen(!menuOpen)}
          className="h-8 w-8"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setMenuOpen(false)}
            />
            <div className="absolute right-0 top-8 z-40 w-48 rounded-md border bg-card shadow-lg">
              {/* Edit */}
              <ClientDialog
                initial={client}
                trigger={
                  <button
                    onClick={() => setMenuOpen(false)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted rounded-t-md"
                  >
                    <Pencil className="h-4 w-4" />
                    Editar
                  </button>
                }
              />

              {/* Mark as churned */}
              {client.status !== "CHURNED" && (
                <ClientLossDialog
                  clientId={client.id}
                  clientName={client.name}
                  trigger={
                    <button
                      onClick={() => setMenuOpen(false)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted text-amber-600"
                    >
                      <UserX className="h-4 w-4" />
                      Marcar como perdido
                    </button>
                  }
                />
              )}

              {/* Delete */}
              <button
                onClick={() => {
                  setMenuOpen(false);
                  if (!confirm(`Excluir o cliente "${client.name}"?`)) return;
                  start(async () => {
                    const res = await deleteClient(client.id);
                    if (!res.ok) alert(res.error);
                  });
                }}
                disabled={pending}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-muted text-destructive rounded-b-md"
              >
                <Trash2 className="h-4 w-4" />
                Excluir
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
