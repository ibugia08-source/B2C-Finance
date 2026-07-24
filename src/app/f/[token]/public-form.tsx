"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2 } from "lucide-react";
import { submitPublicContractForm } from "@/lib/actions/public-contract-form";
import { variableInputProps } from "@/lib/docx/prefill";
import type { TemplateVariable } from "@/lib/docx/template";

/** Uma pergunta por variável do modelo — os rótulos vêm do mapeamento. */
export function PublicContractForm({
  token,
  variables,
  defaults,
}: {
  token: string;
  variables: TemplateVariable[];
  defaults: Record<string, string>;
}) {
  const [values, setValues] = useState<Record<string, string>>(defaults);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const missing = variables.filter(
    (v) => v.required && !(values[v.rawName] ?? "").trim()
  );

  if (done) {
    return (
      <div className="py-8 text-center space-y-3">
        <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
        <p className="text-lg font-semibold">Recebemos seus dados!</p>
        <p className="text-sm text-muted-foreground">
          A equipe da B2C Gestão vai preparar o contrato e enviar para você
          conferir e assinar. Pode fechar esta página.
        </p>
      </div>
    );
  }

  return (
    <form
      action={() =>
        start(async () => {
          setError(null);
          const fd = new FormData();
          fd.set("token", token);
          fd.set("values", JSON.stringify(values));
          const res = await submitPublicContractForm(fd);
          if (res.ok) setDone(true);
          else setError(res.error);
        })
      }
      className="space-y-4"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {variables.map((v) => (
          <div key={v.rawName} className={v.type === "text" ? "sm:col-span-2" : undefined}>
            <Label>
              {v.label} {v.required && <span className="text-destructive">*</span>}
            </Label>
            <Input
              className="mt-1"
              value={values[v.rawName] ?? ""}
              onChange={(e) =>
                setValues((p) => ({ ...p, [v.rawName]: e.target.value }))
              }
              required={v.required}
              {...variableInputProps(v.type)}
            />
          </div>
        ))}
      </div>

      {variables.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Este contrato não precisa de informações adicionais — basta confirmar
          abaixo.
        </p>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={pending || missing.length > 0}>
        {pending ? "Enviando…" : "Enviar dados do contrato"}
      </Button>
      {missing.length > 0 && (
        <p className="text-center text-xs text-muted-foreground">
          Preencha os campos obrigatórios (*) para enviar.
        </p>
      )}
    </form>
  );
}
