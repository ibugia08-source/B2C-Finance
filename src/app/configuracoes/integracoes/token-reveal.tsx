"use client";
import { useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * O token completo, mostrado UMA vez. Nada aqui o guarda: fechou o diálogo,
 * ele só existe onde o usuário colou.
 */
export function TokenReveal({ token }: { token: string }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(token);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o campo já vem selecionável.
      setCopiado(false);
    }
  }

  return (
    <div className="space-y-3">
      <div role="alert" className="flex gap-2 rounded-lg bg-warning-soft p-3 text-dense text-warning-ink">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Copie o token agora e guarde num cofre de credenciais (no n8n, em <strong>Credentials</strong>).
          Por segurança ele <strong>não será mostrado de novo</strong> — se perder, rotacione a chave.
        </p>
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          value={token}
          aria-label="Token da integração"
          onFocus={(e) => e.currentTarget.select()}
          className="h-11 w-full min-w-0 rounded-lg border border-input bg-muted px-3 font-mono text-dense text-foreground"
        />
        <Button type="button" variant="outline" onClick={copiar} className="h-11 shrink-0">
          {copiado ? <Check className="mr-1 h-4 w-4" aria-hidden /> : <Copy className="mr-1 h-4 w-4" aria-hidden />}
          {copiado ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <p className="text-caption text-muted-foreground">
        Use no header <code className="font-mono">Authorization: Bearer &lt;token&gt;</code>. Teste com{" "}
        <code className="font-mono">GET /api/v1/me</code>.
      </p>
    </div>
  );
}
