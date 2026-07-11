"use client";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  buildBillingMessage,
  whatsappLink,
  TONE_LABEL,
  type MessageTone,
  type BillingMessageInput,
} from "@/lib/billing-message";
import { Copy, Check, MessageCircle } from "lucide-react";
import { registerBillingContact } from "@/lib/actions/billings";

/** Apoio interativo à cobrança: mensagens por tom + copiar + WhatsApp. */
export function MessageDialog({
  input,
  phone,
  trigger,
  billingId,
}: {
  input: BillingMessageInput;
  phone: string | null;
  trigger: React.ReactNode;
  /** quando informado, registra no histórico que a cobrança foi enviada/copiada */
  billingId?: string;
}) {
  const [tone, setTone] = useState<MessageTone>("padrao");
  const [copied, setCopied] = useState(false);
  const [text, setText] = useState<string | null>(null);

  const message = useMemo(
    () => text ?? buildBillingMessage(tone, input),
    [tone, input, text]
  );
  const wa = whatsappLink(phone, message);

  // Fire-and-forget: registra o envio no histórico de cobrança do cliente.
  function logContact(channel: "whatsapp" | "copia") {
    if (billingId) void registerBillingContact(billingId, channel, message);
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mensagem de cobrança</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Tom da mensagem</Label>
            <Select
              value={tone}
              onChange={(e) => {
                setTone(e.target.value as MessageTone);
                setText(null); // volta ao template do novo tom
              }}
            >
              {Object.entries(TONE_LABEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Mensagem (edite à vontade)</Label>
            <Textarea
              rows={9}
              value={message}
              onChange={(e) => setText(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(message);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
                logContact("copia");
              }}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 mr-1" /> Copiado!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 mr-1" /> Copiar
                </>
              )}
            </Button>
            {wa ? (
              <Button asChild>
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => logContact("whatsapp")}
                >
                  <MessageCircle className="h-4 w-4 mr-1" /> Abrir WhatsApp
                </a>
              </Button>
            ) : (
              <Button disabled title="Cliente sem telefone cadastrado">
                <MessageCircle className="h-4 w-4 mr-1" /> Sem WhatsApp
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
