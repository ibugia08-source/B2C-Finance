"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { generateBillingText } from "@/lib/actions/people";
import { MessageSquare, Copy, Check } from "lucide-react";

export function BillingDialog({ personId }: { personId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState(false);

  function handleOpen(o: boolean) {
    setOpen(o);
    if (o) {
      start(async () => {
        const t = await generateBillingText(personId);
        setText(t);
      });
    } else {
      setText("");
      setCopied(false);
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <MessageSquare className="h-4 w-4 mr-1" /> Gerar cobrança
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Texto de cobrança</DialogTitle>
        </DialogHeader>
        {pending ? (
          <p className="text-sm text-muted-foreground">Gerando…</p>
        ) : (
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            className="font-mono text-sm"
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Fechar
          </Button>
          <Button onClick={copy} disabled={!text}>
            {copied ? (
              <>
                <Check className="h-4 w-4 mr-1" /> Copiado
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-1" /> Copiar
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
