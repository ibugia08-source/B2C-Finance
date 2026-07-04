"use client";
import { useState, useRef, useEffect, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendChatMessage } from "@/lib/actions/ai";
import { SimpleMarkdown } from "./markdown";
import { B2CAvatar, B2CMascot } from "@/components/mascot";
import { Send, User } from "lucide-react";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Como está minha saúde financeira este mês?",
  "Onde estou gastando demais?",
  "O que devo priorizar para pagar primeiro?",
  "Me dê 3 dicas para sobrar mais dinheiro.",
];

export function Chat({
  conversationId,
  initialMessages,
  configured,
  initialTokens,
}: {
  conversationId: string | null;
  initialMessages: Msg[];
  configured: boolean;
  initialTokens: number;
}) {
  const [convId, setConvId] = useState(conversationId);
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [tokens, setTokens] = useState(initialTokens);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pending]);

  function submit(text: string) {
    const content = text.trim();
    if (!content || pending) return;
    setError(null);
    setMessages((m) => [...m, { role: "user", content }]);
    setInput("");
    start(async () => {
      const r = await sendChatMessage(convId, content);
      if (r.ok) {
        setConvId(r.conversationId);
        setMessages((m) => [...m, { role: "assistant", content: r.answer }]);
        setTokens((t) => t + r.tokens);
      } else {
        setError(r.error);
        // remove a mensagem otimista que falhou
        setMessages((m) => m.slice(0, -1));
        setInput(content);
      }
    });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-220px)] min-h-[420px]">
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground gap-3">
            <B2CMascot pose="hero" width={150} className="drop-shadow-xl" />
            <p className="text-sm max-w-sm">
              Pergunte qualquer coisa sobre suas finanças. O copiloto enxerga suas transações,
              faturas, gastos, pessoas e metas.
            </p>
            {configured && (
              <div className="flex flex-wrap gap-2 justify-center max-w-md">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="text-xs rounded-full border px-3 py-1.5 hover:bg-muted transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            {m.role === "assistant" && (
              <div className="shrink-0 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
                <B2CAvatar size={26} />
              </div>
            )}
            <div
              className={`rounded-2xl px-3.5 py-2.5 max-w-[80%] ${
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {m.role === "assistant" ? (
                <SimpleMarkdown text={m.content} />
              ) : (
                <p className="text-sm whitespace-pre-wrap">{m.content}</p>
              )}
            </div>
            {m.role === "user" && (
              <div className="shrink-0 h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}

        {pending && (
          <div className="flex gap-2 items-center text-muted-foreground text-sm">
            <div className="shrink-0 h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden">
              <B2CAvatar size={26} />
            </div>
            <span className="animate-pulse">Analisando seus dados…</span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive mt-2">
          {error}
        </div>
      )}

      <div className="mt-3 border-t pt-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(input);
              }
            }}
            placeholder={configured ? "Escreva sua pergunta…" : "Configure a IA para começar"}
            disabled={!configured || pending}
            rows={1}
            className="resize-none min-h-[44px]"
          />
          <Button onClick={() => submit(input)} disabled={!configured || pending || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Enter envia · Shift+Enter quebra linha · {tokens.toLocaleString("pt-BR")} tokens nesta conversa
        </p>
      </div>
    </div>
  );
}
