"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { updateTemplateVariables } from "@/lib/actions/contract-templates";
import type { TemplateVariable } from "@/lib/docx/template";
import { CLIENT_FIELD_OPTIONS } from "../_meta";
import { Check } from "lucide-react";

/**
 * Editor do mapeamento das variáveis do modelo: rótulo do formulário,
 * obrigatoriedade e de onde vem o pré-preenchimento. Os tokens do
 * arquivo nunca mudam por aqui.
 */
export function VariablesEditor({
  templateId,
  variables,
}: {
  templateId: string;
  variables: TemplateVariable[];
}) {
  const [rows, setRows] = useState(variables);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  function patch(i: number, changes: Partial<TemplateVariable>) {
    setSaved(false);
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...changes } : r)));
  }

  function save() {
    const fd = new FormData();
    fd.set("id", templateId);
    fd.set("variables", JSON.stringify(rows));
    start(async () => {
      setError(null);
      const res = await updateTemplateVariables(fd);
      if (res.ok) setSaved(true);
      else setError(res.error);
    });
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b">
              <th className="py-2 pr-3 font-medium">Variável no DOCX</th>
              <th className="py-2 pr-3 font-medium">Rótulo no formulário</th>
              <th className="py-2 pr-3 font-medium">Pré-preenchimento</th>
              <th className="py-2 font-medium">Obrigatória</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v, i) => (
              <tr key={v.rawName} className="border-b last:border-0">
                <td className="py-2 pr-3">
                  <code className="text-xs bg-accent rounded px-1.5 py-0.5">{v.originalToken}</code>
                </td>
                <td className="py-2 pr-3">
                  <Input
                    className="h-9"
                    value={v.label}
                    onChange={(e) => patch(i, { label: e.target.value })}
                  />
                </td>
                <td className="py-2 pr-3">
                  <Select
                    className="h-9"
                    value={v.clientField ?? ""}
                    onChange={(e) => patch(i, { clientField: e.target.value || null })}
                  >
                    {CLIENT_FIELD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </Select>
                </td>
                <td className="py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                    checked={v.required}
                    onChange={(e) => patch(i, { required: e.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={pending} size="sm">
          {pending ? "Salvando…" : "Salvar mapeamento"}
        </Button>
        {saved && (
          <span className="text-sm text-emerald-600 flex items-center gap-1">
            <Check className="h-4 w-4" /> salvo
          </span>
        )}
      </div>
    </div>
  );
}
