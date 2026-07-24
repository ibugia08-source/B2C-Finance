"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link2, Copy, Check, Power } from "lucide-react";
import { createFormLink, setFormLinkActive } from "@/lib/actions/contract-templates";

export type FormLinkRow = {
  id: string;
  token: string;
  active: boolean;
  submissions: number;
  clientName: string | null;
  createdAtBR: string;
};

/**
 * "Link do formulário" — o substituto do ZapSign: cada link abre /f/{token}
 * público, onde o cliente (ou a equipe) responde as variáveis e o contrato é
 * gerado aqui dentro. Link geral serve para qualquer cliente; link
 * direcionado pré-preenche o cadastro daquele cliente.
 */
export function FormLinkCard({
  templateId,
  links,
  clients,
  canManage,
}: {
  templateId: string;
  links: FormLinkRow[];
  clients: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [clientId, setClientId] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function urlFor(token: string) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/f/${token}`;
  }

  async function copy(token: string) {
    try {
      await navigator.clipboard.writeText(urlFor(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      prompt("Copie o link:", urlFor(token));
    }
  }

  function create() {
    start(async () => {
      setError(null);
      const res = await createFormLink(templateId, clientId || null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setClientId("");
      if (res.url) {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${res.url}`);
          setCopied(res.url.replace("/f/", ""));
          setTimeout(() => setCopied(null), 2500);
        } catch {
          /* usuário copia pela lista */
        }
      }
    });
  }

  function toggle(link: FormLinkRow) {
    start(async () => {
      setError(null);
      const res = await setFormLinkActive(link.id, !link.active);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          Link do formulário
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            envie e o contrato chega pronto — sem ZapSign
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {canManage && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-full sm:w-72">
              <p className="mb-1 text-xs text-muted-foreground">
                Direcionar a um cliente (opcional — pré-preenche o cadastro dele)
              </p>
              <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
                <option value="">Link geral (qualquer cliente)</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button onClick={create} disabled={pending}>
              <Link2 className="h-4 w-4 mr-1" />
              {pending ? "Criando…" : "Criar link"}
            </Button>
          </div>
        )}

        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum link criado ainda. Crie um link e envie por WhatsApp — quem
            abrir responde um formulário e o contrato é gerado aqui dentro,
            pronto para revisão.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm">
                <code className="max-w-[16rem] truncate rounded bg-muted px-1.5 py-0.5 text-xs">
                  /f/{l.token.slice(0, 10)}…
                </code>
                {l.clientName ? (
                  <Badge variant="secondary">{l.clientName}</Badge>
                ) : (
                  <Badge variant="outline">geral</Badge>
                )}
                {!l.active && <Badge variant="destructive">desativado</Badge>}
                <span className="text-xs text-muted-foreground">
                  {l.submissions} resposta{l.submissions === 1 ? "" : "s"} · criado em {l.createdAtBR}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => copy(l.token)}
                    disabled={!l.active}
                    title={l.active ? "Copiar link" : "Reative para copiar"}
                  >
                    {copied === l.token ? (
                      <>
                        <Check className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
                      </>
                    )}
                  </Button>
                  {canManage && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7"
                      disabled={pending}
                      onClick={() => toggle(l)}
                      title={l.active ? "Desativar link" : "Reativar link"}
                    >
                      <Power className={`h-3.5 w-3.5 ${l.active ? "text-destructive" : "text-emerald-600"}`} />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
