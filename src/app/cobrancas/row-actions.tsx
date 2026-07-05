"use client";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  DollarSign,
  MessageSquareText,
  StickyNote,
  CalendarClock,
  Handshake,
  Pencil,
  Ban,
} from "lucide-react";
import { cancelBilling } from "@/lib/actions/billings";
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
}: {
  billing: any; // serializado (openAmount number)
  messageInput: BillingMessageInput;
  phone: string | null;
  accounts: { id: string; name: string }[];
  clients: { id: string; name: string }[];
  contracts: { id: string; title: string; clientId: string }[];
  services: { id: string; name: string }[];
}) {
  const [pending, start] = useTransition();
  const open = ["PENDING", "PARTIAL", "OVERDUE"].includes(billing.status);

  return (
    <div className="flex gap-0.5 justify-end flex-wrap">
      {open && (
        <PaymentDialog
          billing={{
            id: billing.id,
            openAmount: billing.openAmount,
            description: billing.description,
          }}
          accounts={accounts}
          trigger={
            <Button variant="ghost" size="icon" title="Registrar pagamento (total ou parcial)">
              <DollarSign className="h-4 w-4 text-emerald-600" />
            </Button>
          }
        />
      )}
      {open && (
        <MessageDialog
          input={messageInput}
          phone={phone}
          trigger={
            <Button variant="ghost" size="icon" title="Mensagem de cobrança / WhatsApp">
              <MessageSquareText className="h-4 w-4" />
            </Button>
          }
        />
      )}
      {open && (
        <NoteDialog
          billingId={billing.id}
          promise
          trigger={
            <Button variant="ghost" size="icon" title="Registrar promessa de pagamento">
              <Handshake className="h-4 w-4 text-amber-600" />
            </Button>
          }
        />
      )}
      {open && (
        <NoteDialog
          billingId={billing.id}
          trigger={
            <Button variant="ghost" size="icon" title="Adicionar observação">
              <StickyNote className="h-4 w-4" />
            </Button>
          }
        />
      )}
      {open && (
        <RescheduleDialog
          billingId={billing.id}
          trigger={
            <Button variant="ghost" size="icon" title="Reagendar vencimento">
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
            <Button variant="ghost" size="icon" title="Editar">
              <Pencil className="h-4 w-4" />
            </Button>
          }
        />
      )}
      {open && (
        <Button
          variant="ghost"
          size="icon"
          title="Cancelar cobrança"
          disabled={pending}
          onClick={() => {
            if (!confirm(`Cancelar a cobrança "${billing.description}"?`)) return;
            start(async () => {
              const res = await cancelBilling(billing.id);
              if (!res.ok) alert(res.error);
            });
          }}
        >
          <Ban className="h-4 w-4 text-destructive" />
        </Button>
      )}
    </div>
  );
}
