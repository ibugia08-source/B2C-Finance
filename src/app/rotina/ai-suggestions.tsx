"use client";
import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, RefreshCw } from "lucide-react";
import {
  generateRoutineSuggestions,
  type RoutineSuggestion,
} from "@/lib/actions/ai-routine";

const PRIORITY_META: Record<string, { label: string; variant: any }> = {
  alta: { label: "Alta", variant: "destructive" },
  media: { label: "Média", variant: "warning" },
  baixa: { label: "Baixa", variant: "secondary" },
};

/** Painel de sugestões da IA na rotina — analisa apenas dados reais. */
export function AISuggestionsPanel() {
  const [suggestions, setSuggestions] = useState<RoutineSuggestion[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function generate() {
    start(async () => {
      setError(null);
      setNote(null);
      const res = await generateRoutineSuggestions();
      if (res.ok) {
        setSuggestions(res.suggestions);
        if (res.note) setNote(res.note);
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <Card className="border-primary/25 bg-primary/[0.03]">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs uppercase tracking-wide text-primary font-medium flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Sugestões da IA
          </p>
          <Button size="sm" variant="outline" onClick={generate} disabled={pending}>
            {pending ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" /> Analisando…
              </>
            ) : suggestions ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Atualizar
              </>
            ) : (
              "Gerar sugestões"
            )}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {note && <p className="text-sm text-muted-foreground">{note}</p>}

        {!suggestions && !error && !pending && (
          <p className="text-sm text-muted-foreground">
            A IA analisa cobranças, pagamentos, MRR/TCV, renovações, perdas,
            despesas, cartões e upsell — apenas dados reais da plataforma — e
            sugere as ações da semana com prioridade.
          </p>
        )}

        {suggestions && suggestions.length > 0 && (
          <ol className="space-y-3">
            {suggestions.map((s, i) => {
              const pm = PRIORITY_META[s.priority];
              return (
                <li key={i} className="flex items-start gap-2.5">
                  <Badge variant={pm.variant} className="mt-0.5 shrink-0">
                    {pm.label}
                  </Badge>
                  <span className="min-w-0">
                    {s.insight && (
                      <span className="block text-xs text-muted-foreground">
                        {s.insight}
                      </span>
                    )}
                    <span className="block text-sm font-medium">{s.action}</span>
                    <span className="block text-xs text-muted-foreground">{s.reason}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
