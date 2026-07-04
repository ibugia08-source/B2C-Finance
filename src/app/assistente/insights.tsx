"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { generateInsights } from "@/lib/actions/ai";
import { SimpleMarkdown } from "./markdown";
import { Sparkles } from "lucide-react";

export function Insights({ configured }: { configured: boolean }) {
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <Button
        className="w-full"
        disabled={!configured || pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await generateInsights();
            if (r.ok) setReport(r.report);
            else setError(r.error);
          })
        }
      >
        <Sparkles className="h-4 w-4 mr-1" />
        {pending ? "Gerando análise…" : "Gerar análise do meu momento"}
      </Button>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {report && (
        <div className="rounded-lg border bg-card p-3 max-h-[420px] overflow-y-auto">
          <SimpleMarkdown text={report} />
        </div>
      )}
    </div>
  );
}
