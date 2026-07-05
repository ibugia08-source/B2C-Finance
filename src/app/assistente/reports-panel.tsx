"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { generateAIReport } from "@/lib/actions/ai";
import { AI_REPORTS } from "@/lib/ai/reports-meta";
import { SimpleMarkdown } from "./markdown";
import { FileBarChart2, Copy, Check } from "lucide-react";

/** Relatórios executivos gerados pela IA sobre os dados reais da agência (admin). */
export function AIReportsPanel({ configured }: { configured: boolean }) {
  const [kind, setKind] = useState<string>(AI_REPORTS[0].key);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="flex-1">
          {AI_REPORTS.map((r) => (
            <option key={r.key} value={r.key}>{r.label}</option>
          ))}
        </Select>
        <Button
          disabled={!configured || pending}
          onClick={() =>
            start(async () => {
              setError(null);
              setReport(null);
              const r = await generateAIReport(kind);
              if (r.ok) setReport(r.report);
              else setError(r.error);
            })
          }
        >
          <FileBarChart2 className="h-4 w-4 mr-1" />
          {pending ? "Gerando…" : "Gerar"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Gerado com os números reais do snapshot da agência — fato, projeção e sugestão são diferenciados.
      </p>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {report && (
        <div className="rounded-lg border bg-card">
          <div className="flex justify-end px-3 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => {
                navigator.clipboard.writeText(report);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <div className="p-3 pt-0 max-h-[480px] overflow-y-auto">
            <SimpleMarkdown text={report} />
          </div>
        </div>
      )}
    </div>
  );
}
