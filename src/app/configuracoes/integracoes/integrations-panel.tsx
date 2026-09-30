"use client";
import { useState, useTransition } from "react";
import { KeyRound, RefreshCw, Ban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/empty-state";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { formatInstantBR, formatInstantTimeBR } from "@/lib/format";
import { apiScopeLabel } from "@/lib/api/scopes";
import { revogarIntegracaoAction, rotacionarIntegracaoAction } from "@/lib/actions/integrations";
import { TokenReveal } from "./token-reveal";

export type IntegracaoRow = {
  id: string;
  name: string;
  description: string | null;
  estado: "ativa" | "expirada" | "revogada";
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rotatedAt: string | null;
};

const ESTADO: Record<IntegracaoRow["estado"], { label: string; className: string }> = {
  ativa: { label: "Ativa", className: "bg-success-soft text-success-ink" },
  expirada: { label: "Expirada", className: "bg-warning-soft text-warning-ink" },
  revogada: { label: "Revogada", className: "bg-muted text-muted-foreground" },
};

export function IntegrationsPanel({ rows, gerencia }: { rows: IntegracaoRow[]; gerencia: boolean }) {
  const [token, setToken] = useState<{ nome: string; valor: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, start] = useTransition();

  async function rotacionar(r: IntegracaoRow) {
    const ok = await confirmAction({
      title: `Rotacionar a chave de “${r.name}”?`,
      description:
        "Um token novo é gerado e o atual para de funcionar na hora. Atualize a credencial no n8n logo em seguida.",
      confirmLabel: "Rotacionar",
    });
    if (!ok) return;
    start(async () => {
      setErro(null);
      const res = await rotacionarIntegracaoAction(r.id);
      if (res.ok) setToken({ nome: r.name, valor: res.token });
      else setErro(res.error);
    });
  }

  async function revogar(r: IntegracaoRow) {
    const ok = await confirmAction({
      title: `Revogar “${r.name}”?`,
      description: "A integração perde o acesso imediatamente e não pode ser reativada.",
      confirmLabel: "Revogar",
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      setErro(null);
      const res = await revogarIntegracaoAction(r.id);
      if (!res.ok) setErro(res.error);
    });
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        title="Nenhuma integração ainda"
        description={
          gerencia
            ? "Crie uma integração para o n8n acessar a API com scopes próprios — sem usar o login de ninguém."
            : "O administrador ainda não criou integrações."
        }
      />
    );
  }

  return (
    <>
      {erro && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft p-3 text-dense text-danger-ink">
          {erro}
        </p>
      )}
      <ul className="space-y-3">
        {rows.map((r) => {
          const e = ESTADO[r.estado];
          return (
            <li key={r.id}>
              <Card>
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-base font-semibold">{r.name}</h2>
                        <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${e.className}`}>
                          {e.label}
                        </span>
                        <span className="rounded-full bg-info-soft px-2 py-0.5 text-caption font-medium text-info-ink">
                          Integração
                        </span>
                      </div>
                      {r.description && <p className="mt-1 text-dense text-muted-foreground">{r.description}</p>}
                      <p className="mt-1 font-mono text-caption text-muted-foreground">{r.tokenPrefix}_••••••</p>
                    </div>
                    {gerencia && r.estado !== "revogada" && (
                      <div className="flex shrink-0 gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={() => rotacionar(r)}>
                          <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Rotacionar
                        </Button>
                        <Button type="button" variant="outline" size="sm" disabled={pendente} onClick={() => revogar(r)}>
                          <Ban className="mr-1 h-3.5 w-3.5" aria-hidden /> Revogar
                        </Button>
                      </div>
                    )}
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-dense sm:grid-cols-4">
                    <div>
                      <dt className="text-caption text-muted-foreground">Último uso</dt>
                      <dd>{r.lastUsedAt ? formatInstantTimeBR(r.lastUsedAt) : "Nunca usada"}</dd>
                    </div>
                    <div>
                      <dt className="text-caption text-muted-foreground">Criada em</dt>
                      <dd>{formatInstantBR(r.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-caption text-muted-foreground">
                        {r.estado === "revogada" ? "Revogada em" : "Expira em"}
                      </dt>
                      <dd>
                        {r.estado === "revogada"
                          ? formatInstantBR(r.revokedAt)
                          : r.expiresAt
                            ? formatInstantBR(r.expiresAt)
                            : "Sem expiração"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-caption text-muted-foreground">Última rotação</dt>
                      <dd>{r.rotatedAt ? formatInstantBR(r.rotatedAt) : "—"}</dd>
                    </div>
                  </dl>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-caption text-muted-foreground hover:text-foreground">
                      {r.scopes.length} scope(s)
                    </summary>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {r.scopes.map((s) => (
                        <li key={s} title={apiScopeLabel(s)} className="rounded-md border px-2 py-0.5 font-mono text-caption">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </details>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      <Dialog open={!!token} onOpenChange={(o) => !o && setToken(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Chave rotacionada</DialogTitle>
            <DialogDescription>Novo token de “{token?.nome}”. O anterior já não funciona.</DialogDescription>
          </DialogHeader>
          {token && <TokenReveal token={token.valor} />}
          <DialogFooter>
            <Button type="button" onClick={() => setToken(null)}>
              Já guardei o token
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
