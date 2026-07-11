"use client";
import { useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DollarSign,
  MessageSquareText,
  StickyNote,
  CalendarClock,
  Handshake,
  Pencil,
  Eye,
  Ban,
  RotateCcw,
} from "lucide-react";
import { cancelBilling, restoreBilling } from "@/lib/actions/billings";
import { PaymentDialog } from "./payment-dialog";
import { MessageDialog } from "./message-dialog";
import { NoteDialog, RescheduleDialog } from "./note-dialog";
import { BillingDialog } from "./billing-dialog";
import type { BillingMessageInput } from "@/lib/billing-message";

export function BillingActions({
  billing,
  messageInput,
  phone,
  accounts,
  clients,
  contracts,
  services,
  primaryLabels = false,
}: {
  billing: any; // serializado (openAmount number)
  messageInput: BillingMessageInput;
  phone: string | null;
  accounts: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  contracts: { id: string; title: string; clientId: string }[];
  services: { id: string; name: string }[];
  /** mobile: mostra "Registrar pagamento" e "Cobrar" como botões com texto */
  primaryLabels?: boolean;
}) {
  const [pending, start] = useTransition();
  const open = ["PENDING", "PARTIAL", "OVERDUE"].includes(billing.status);

  return (
    <div className="flex gap-0.5 justify-end flex-wrap items-center">
      {open && (
        <PaymentDialog
          billing={{
            id: billing.id,
            openAmount: billing.openAmount,
            description: billing.description,
          }}
          accounts={accounts}
          trigger={
            primaryLabels ? (
              <Button size="sm" aria-label="Registrar pagamento">
                <DollarSign className="h-4 w-4 mr-1" /> Registrar pagamento
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                title="Registrar pagamento (total ou parcial)"
                aria-label="Registrar pagamento"
              >
                <DollarSign className="h-4 w-4 text-emerald-600" />
              </Button>
            )
          }
        />
      )}
      {open && (
        <MessageDialog
          input={messageInput}
          phone={phone}
          billingId={billing.id}
          trigger={
            primaryLabels ? (
              <Button variant="outline" size="sm" aria-label="Cobrar (mensagem/WhatsApp)">
                <MessageSquareText className="h-4 w-4 mr-1" /> Cobrar
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                title="Cobrar — mensagem pronta / WhatsApp"
                aria-label="Cobrar (mensagem/WhatsApp)"
              >
                <MessageSquareText className="h-4 w-4" />
              </Button>
            )
          }
        />
      )}
      {open && (
        <NoteDialog
          billingId={billing.id}
          promise
          trigger={
            <Button variant="ghost" size="icon" title="Registrar promessa de pagamento" aria-label="Registrar promessa de pagamento">
              <Handshake className="h-4 w-4 text-amber-600" />
            </Button>
          }
        />
      )}
      {open && (
        <NoteDialog
          billingId={billing.id}
          trigger={
            <Button variant="ghost" size="icon" title="Adicionar observação" aria-label="Adicionar observação">
              <StickyNote className="h-4 w-4" />
            </Button>
          }
        />
      )}
      {open && (
        <RescheduleDialog
          billingId={billing.id}
          trigger={
            <Button variant="ghost" size="icon" title="Reagendar vencimento" aria-label="Reagendar vencimento">
              <CalendarClock className="h-4 w-4" />
            </Button>
          }
        />
      )}
      {open && (
        <BillingDialog
          clients={clients}
          contracts={contracts}
          services={services}
          initial={billing}
          trigger={
            <Button variant="ghost" size="icon" title="Editar" aria-label="Editar cobrança">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
      )}
      {billing.client?.id && (
        <Button variant="ghost" size="icon" asChild title="Ver cliente (Gestão de Carteira)" aria-label="Ver cliente na Gestão de Carteira">
          <Link href={`/clientes/${billing.client.id}`}>
            <Eye className="h-4 w-4" />
          </Link>
        </Button>
      )}
      {open && (
        <Button
          variant="ghost"
          size="icon"
          title="Remover deste mês (não apaga o cliente; não será recriado pela geração automática)"
          aria-label="Remover do ciclo deste mês"
          disabled={pending}
          onClick={() => {
            const reason = prompt(
              `Remover "${billing.description}" do ciclo deste mês?\n\nO cliente continua na Gestão de Carteira — apenas sai da lista deste mês e NÃO será recriado automaticamente.\n\nMotivo da remoção (opcional):`
            );
            if (reason === null) return; // cancelou
            start(async () => {
              const res = await cancelBilling(billing.id, reason);
              if (!res.ok) alert(res.error);
            });
          }}
        >
          <Ban className="h-4 w-4 text-destructive" />
        </Button>
      )}
      {billing.status === "CANCELED" && (
        <Button
          variant="ghost"
          size="icon"
          title="Recolocar no ciclo deste mês"
          aria-label="Recolocar no ciclo deste mês"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Recolocar "${billing.description}" no ciclo deste mês?`)) return;
            start(async () => {
              const res = await restoreBilling(billing.id);
              if (!res.ok) alert(res.error);
            });
          }}
        >
          <RotateCcw className="h-4 w-4 text-emerald-600" />
        </Button>
      )}
    </div>
  );
}
