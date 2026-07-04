"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { simulateMessage, sendRemindersNow } from "@/lib/actions/whatsapp";
import { B2CAvatar } from "@/components/mascot";
import { Send, Bell } from "lucide-react";

const EXAMPLES = [
  "Gastei 50 no mercado hoje no pix",
  "Recebi 3000 de salário ontem",
  "Criar caixa Reserva de emergência com 1000",
  "Quanto gastei esse mês?",
];

const ACTION_LABEL: Record<string, string> = {
  add_expense: "Despesa criada",
  add_income: "Receita criada",
  add_cashbox: "Caixa criado",
  add_cash_movement: "Movimentação de caixa",
  query: "Consulta",
  smalltalk: "Conversa",
  error: "Erro",
};

export function WhatsAppSimulator() {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ reply: string; action: string; error?: string } | null>(null);
  const [reminderMsg, setReminderMsg] = useState<string | null>(null);

  function run(t: string) {
    const msg = t.trim();
    if (!msg || pending) return;
    setReminderMsg(null);
    start(async () => {
      const r = await simulateMessage(msg);
      setResult({ reply: r.reply, action: r.action, error: r.error });
      setText("");
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Teste o agente sem WhatsApp: escreva como se estivesse mandando uma mensagem. O agente
        interpreta e <strong>já cria de verdade</strong> no sistema.
      </p>

      <div className="flex flex-wrap gap-2">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            onClick={() => run(e)}
            disabled={pending}
            className="text-xs rounded-full border px-3 py-1.5 hover:bg-accent transition-colors"
          >
            {e}
          </button>
        ))}
      </div>

      <div className="flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              run(text);
            }
          }}
          placeholder="Ex.: paguei 120 de luz, vence dia 30"
          rows={1}
          className="resize-none min-h-[44px]"
        />
        <Button onClick={() => run(text)} disabled={pending || !text.trim()}>
          <Send className="h-4 w-4" />
        </Button>
      </div>

      {pending && <p className="text-sm text-muted-foreground animate-pulse">B2C está pensando…</p>}

      {result && (
        <div className="flex gap-2">
          <div className="shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
            <B2CAvatar size={30} />
          </div>
          <div className="flex-1 rounded-2xl bg-muted px-3.5 py-2.5">
            <Badge variant={result.error ? "destructive" : "secondary"} className="mb-1.5 text-[10px]">
              {ACTION_LABEL[result.action] ?? result.action}
            </Badge>
            <p className="text-sm whitespace-pre-wrap">{result.reply}</p>
          </div>
        </div>
      )}

      <div className="pt-2 border-t">
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await sendRemindersNow();
              setReminderMsg(r.message);
            })
          }
        >
          <Bell className="h-4 w-4 mr-1" /> Enviar lembretes agora
        </Button>
        {reminderMsg && <p className="text-xs text-muted-foreground mt-2">{reminderMsg}</p>}
      </div>
    </div>
  );
}
